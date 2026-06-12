"""
RAG service — embed → store → retrieve.

Pipeline:
  ingest:  text → chunks (400 words, 80 overlap)
                → sentence-transformers embeddings (all-MiniLM-L6-v2)
                → hnswlib cosine index (persisted to disk)

  query:   embed query → kNN search → similarity threshold filter
                       → token-budget assembly → context string

Token minimisation:
  - similarity threshold 0.25 filters noise
  - 1800-token context budget stops prompt bloat
  - lazy embedder init (no cost if no knowledge loaded)
"""

from __future__ import annotations

import asyncio
import json
import pickle
from pathlib import Path
from typing import Optional
from uuid import uuid4

import numpy as np

from app.core.logging import get_logger
from app.core.settings import get_settings
from app.models.schemas import KnowledgeChunk

log = get_logger("rag")

# ── Tuning ────────────────────────────────────────────────────────────────────

CHUNK_SIZE          = 400      # words
CHUNK_OVERLAP       = 80       # words
MAX_CONTEXT_TOKENS  = 1800
TOP_K               = 5
SIMILARITY_THRESHOLD = 0.25
EMBEDDING_DIM       = 384      # all-MiniLM-L6-v2

# ── Singleton state ───────────────────────────────────────────────────────────

_embedder       = None
_embedder_lock  = asyncio.Lock()

_index          = None          # hnswlib.Index
_index_lock     = asyncio.Lock()

_chunks:   dict[int, dict] = {}  # id → stored chunk dict
_next_id:  int = 0
_store_lock = asyncio.Lock()

# ── Helpers ───────────────────────────────────────────────────────────────────

def _db_paths() -> tuple[Path, Path]:
    cfg  = get_settings()
    base = Path(cfg.vector_db_path)
    base.mkdir(parents=True, exist_ok=True)
    return base / "index.bin", base / "meta.json"


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _chunk_text(text: str) -> list[str]:
    words  = text.split()
    step   = max(1, CHUNK_SIZE - CHUNK_OVERLAP)
    chunks = []
    for i in range(0, len(words), step):
        chunk = " ".join(words[i : i + CHUNK_SIZE])
        if len(chunk) > 20:
            chunks.append(chunk)
    return chunks


# ── Embedder ──────────────────────────────────────────────────────────────────

async def _get_embedder():
    global _embedder
    async with _embedder_lock:
        if _embedder is not None:
            return _embedder

        cfg = get_settings()
        log.info("loading_embedding_model", cache_dir=cfg.hf_home)

        import os
        os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", cfg.hf_home)
        os.environ.setdefault("HF_HOME", cfg.hf_home)

        # Run in thread pool — model loading is CPU-bound
        loop = asyncio.get_event_loop()
        from sentence_transformers import SentenceTransformer  # type: ignore

        _embedder = await loop.run_in_executor(
            None,
            lambda: SentenceTransformer("all-MiniLM-L6-v2"),
        )
        log.info("embedding_model_ready")
    return _embedder


async def _embed(texts: list[str]) -> np.ndarray:
    model = await _get_embedder()
    loop  = asyncio.get_event_loop()
    vecs  = await loop.run_in_executor(
        None,
        lambda: model.encode(texts, normalize_embeddings=True, show_progress_bar=False),
    )
    return np.array(vecs, dtype=np.float32)


# ── Index ─────────────────────────────────────────────────────────────────────

async def _get_index():
    global _index, _chunks, _next_id
    async with _index_lock:
        if _index is not None:
            return _index

        import hnswlib  # type: ignore

        idx_path, meta_path = _db_paths()

        idx = hnswlib.Index(space="cosine", dim=EMBEDDING_DIM)

        if idx_path.exists() and meta_path.exists():
            try:
                idx.load_index(str(idx_path), max_elements=50_000)
                meta       = json.loads(meta_path.read_text("utf-8"))
                _chunks    = {int(k): v for k, v in meta["chunks"].items()}
                _next_id   = meta["next_id"]
                log.info("vector_index_loaded", chunks=len(_chunks))
            except Exception as exc:
                log.warning("index_load_failed_reinit", error=str(exc))
                idx.init_index(max_elements=50_000, ef_construction=200, M=16)
                _chunks  = {}
                _next_id = 0
        else:
            idx.init_index(max_elements=50_000, ef_construction=200, M=16)
            log.info("vector_index_initialised")

        idx.set_ef(50)
        _index = idx
    return _index


async def _persist_index() -> None:
    idx_path, meta_path = _db_paths()
    async with _store_lock:
        if _index is None:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: _index.save_index(str(idx_path)))
        meta = {"chunks": _chunks, "next_id": _next_id}
        meta_path.write_text(json.dumps(meta, default=str), "utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

async def ingest_document(
    content: str,
    source: str,
    metadata: Optional[dict[str, str]] = None,
) -> int:
    global _next_id

    chunks     = _chunk_text(content)
    embeddings = await _embed(chunks)
    index      = await _get_index()

    async with _store_lock:
        ids = list(range(_next_id, _next_id + len(chunks)))
        index.add_items(embeddings, ids)
        for i, chunk_text in enumerate(chunks):
            _chunks[ids[i]] = {
                "id":       str(uuid4()),
                "content":  chunk_text,
                "source":   source,
                "metadata": {**(metadata or {}), "chunk_index": str(i)},
            }
        _next_id += len(chunks)

    await _persist_index()
    log.info("document_ingested", source=source, chunks=len(chunks))
    return len(chunks)


async def retrieve_context(query: str) -> tuple[list[KnowledgeChunk], str, int]:
    """
    Returns (selected_chunks, context_text, token_estimate).
    """
    if not _chunks:
        return [], "", 0

    index      = await _get_index()
    query_vec  = await _embed([query])
    k          = min(TOP_K, len(_chunks))

    loop   = asyncio.get_event_loop()
    labels, distances = await loop.run_in_executor(
        None,
        lambda: index.knn_query(query_vec, k=k),
    )

    scored: list[tuple[float, dict]] = []
    for label, dist in zip(labels[0], distances[0]):
        score = 1.0 - float(dist)    # cosine distance → similarity
        if score < SIMILARITY_THRESHOLD:
            continue
        chunk = _chunks.get(int(label))
        if chunk:
            scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)

    selected: list[KnowledgeChunk] = []
    budget = MAX_CONTEXT_TOKENS
    for score, chunk in scored:
        t = _estimate_tokens(chunk["content"])
        if t > budget:
            continue
        selected.append(KnowledgeChunk(score=score, **chunk))
        budget -= t

    context_text = "\n\n".join(
        f"[{i+1}] Source: {c.source}\n{c.content}"
        for i, c in enumerate(selected)
    )
    return selected, context_text, MAX_CONTEXT_TOKENS - budget


async def delete_source(source: str) -> int:
    """
    Remove all chunks belonging to *source* from the in-memory store and
    rebuild the hnswlib index without them.

    Returns the number of chunks removed.
    """
    global _index, _chunks, _next_id

    async with _store_lock:
        # Identify chunk IDs to remove
        to_remove = {k for k, v in _chunks.items() if v["source"] == source}
        if not to_remove:
            return 0

        for k in to_remove:
            del _chunks[k]

        # Rebuild index from scratch with surviving chunks
        import hnswlib  # type: ignore
        new_idx = hnswlib.Index(space="cosine", dim=EMBEDDING_DIM)
        new_idx.init_index(max_elements=50_000, ef_construction=200, M=16)

        if _chunks:
            surviving_ids = list(_chunks.keys())
            texts = [_chunks[i]["content"] for i in surviving_ids]
            vecs  = await _embed(texts)
            new_idx.add_items(vecs, surviving_ids)

        new_idx.set_ef(50)
        _index = new_idx

    await _persist_index()
    log.info("source_deleted", source=source, chunks_removed=len(to_remove))
    return len(to_remove)


async def get_knowledge_stats() -> dict:
    sources = list({c["source"] for c in _chunks.values()})
    return {
        "total_chunks": len(_chunks),
        "sources":      sources,
        "index_ready":  _index is not None,
    }


# ── Warm-up ───────────────────────────────────────────────────────────────────

async def warmup() -> None:
    """Pre-load index on startup (embedder loads lazily on first query)."""
    try:
        await _get_index()
    except Exception as exc:
        log.error("rag_warmup_failed", error=str(exc))
