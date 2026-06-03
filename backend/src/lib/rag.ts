/**
 * RAG Engine
 * - Chunking with overlap for better context retrieval
 * - HNSWlib in-memory vector store (persisted to disk)
 * - Token-budget-aware context assembly
 * - Xenova/transformers for local embeddings (no external embedding API calls)
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { KnowledgeChunk, RAGResult } from '@/types';
import { logger } from '@/lib/logger';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;
const MAX_CONTEXT_TOKENS = 1800;
const TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.25;
const EMBEDDING_DIM = 384;

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoredChunk {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, string>;
}

interface VectorStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  index: any | null;
  chunks: Map<number, StoredChunk>;
  nextId: number;
}

interface EmbedderInstance {
  embed: (texts: string[]) => Promise<number[][]>;
}

// ─── Singleton State ─────────────────────────────────────────────────────────

let embedder: EmbedderInstance | null = null;

const store: VectorStore = {
  index: null,
  chunks: new Map(),
  nextId: 0,
};

const dbPath = process.env.VECTOR_DB_PATH || '/tmp/vectordb';
const metaPath = path.join(dbPath, 'meta.json');
const indexPath = path.join(dbPath, 'index.bin');

// ─── Embedder Init ───────────────────────────────────────────────────────────

async function getEmbedder(): Promise<EmbedderInstance> {
  if (embedder) return embedder;

  const { pipeline } = await import('@xenova/transformers');
  const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });

  embedder = {
    async embed(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (const text of texts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: any = await model(text, { pooling: 'mean', normalize: true });
        results.push(Array.from(output.data as Float32Array));
      }
      return results;
    },
  };

  logger.info({ msg: 'Embedder initialized', model: 'Xenova/all-MiniLM-L6-v2' });
  return embedder;
}

// ─── Index Init ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureIndex(): Promise<any> {
  if (store.index) return store.index;

  const { HierarchicalNSW } = await import('hnswlib-node');

  await fs.mkdir(dbPath, { recursive: true });

  const index = new HierarchicalNSW('cosine', EMBEDDING_DIM);

  if (existsSync(indexPath) && existsSync(metaPath)) {
    try {
      index.readIndex(indexPath);
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as {
        chunks: Record<string, StoredChunk>;
        nextId: number;
      };
      store.chunks = new Map(
        Object.entries(meta.chunks).map(([k, v]) => [parseInt(k, 10), v])
      );
      store.nextId = meta.nextId;
      logger.info({ msg: 'Vector index loaded from disk', chunks: store.chunks.size });
    } catch (err) {
      logger.warn({ msg: 'Failed to load index from disk, creating fresh', err });
      index.initIndex(10_000, 16, 200, 100);
    }
  } else {
    index.initIndex(10_000, 16, 200, 100);
    logger.info({ msg: 'New vector index initialized' });
  }

  store.index = index;
  return index;
}

async function persistIndex(): Promise<void> {
  if (!store.index) return;
  try {
    await fs.mkdir(dbPath, { recursive: true });
    store.index.writeIndex(indexPath);
    const meta = {
      chunks: Object.fromEntries(store.chunks),
      nextId: store.nextId,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf-8');
  } catch (err) {
    logger.error({ msg: 'Failed to persist index', err });
  }
}

// ─── Text Chunking ───────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const words = text.trim().split(/\s+/);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const end = Math.min(i + CHUNK_SIZE, words.length);
    chunks.push(words.slice(i, end).join(' '));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    if (i >= words.length) break;
  }

  return chunks.filter((c) => c.length > 20);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function ingestDocument(
  content: string,
  source: string,
  metadata: Record<string, string> = {}
): Promise<number> {
  const [emb, index] = await Promise.all([getEmbedder(), ensureIndex()]);

  const chunks = chunkText(content);
  const embeddings = await emb.embed(chunks);

  let added = 0;
  for (let i = 0; i < chunks.length; i++) {
    const id = store.nextId++;
    const chunk: StoredChunk = {
      id: uuidv4(),
      content: chunks[i],
      source,
      metadata: { ...metadata, chunkIndex: String(i) },
    };

    index.addPoint(embeddings[i], id, true);
    store.chunks.set(id, chunk);
    added++;
  }

  await persistIndex();
  logger.info({ msg: 'Document ingested', source, chunks: added });
  return added;
}

export async function retrieveContext(query: string, topK = TOP_K): Promise<RAGResult> {
  if (store.chunks.size === 0) {
    return { chunks: [], contextText: '', tokenEstimate: 0 };
  }

  const [emb, index] = await Promise.all([getEmbedder(), ensureIndex()]);
  const [queryEmbedding] = await emb.embed([query]);

  const k = Math.min(topK, store.chunks.size);
  const result = index.searchKnn(queryEmbedding, k, undefined) as {
    neighbors: number[];
    distances: number[];
  };

  const scored: KnowledgeChunk[] = result.neighbors
    .map((id: number, i: number) => {
      const chunk = store.chunks.get(id);
      if (!chunk) return null;
      const score = 1 - result.distances[i];
      if (score < SIMILARITY_THRESHOLD) return null;
      return { ...chunk, score } as KnowledgeChunk;
    })
    .filter((c): c is KnowledgeChunk => c !== null)
    .sort((a: KnowledgeChunk, b: KnowledgeChunk) => (b.score ?? 0) - (a.score ?? 0));

  const selected: KnowledgeChunk[] = [];
  let tokenBudget = MAX_CONTEXT_TOKENS;

  for (const chunk of scored) {
    const t = estimateTokens(chunk.content);
    if (t > tokenBudget) continue;
    selected.push(chunk);
    tokenBudget -= t;
  }

  const contextText = selected
    .map((c, i) => `[${i + 1}] (Source: ${c.source})\n${c.content}`)
    .join('\n\n');

  return {
    chunks: selected,
    contextText,
    tokenEstimate: MAX_CONTEXT_TOKENS - tokenBudget,
  };
}

export async function getKnowledgeStats(): Promise<{
  totalChunks: number;
  sources: string[];
  indexReady: boolean;
}> {
  const sources = [...new Set([...store.chunks.values()].map((c) => c.source))];
  return {
    totalChunks: store.chunks.size,
    sources,
    indexReady: store.index !== null,
  };
}

// Eagerly warm up the embedder + index on module load
Promise.all([getEmbedder(), ensureIndex()]).catch((err: unknown) =>
  logger.error({ msg: 'RAG warm-up failed', err })
);
