"""
API routes — AI Receptionist

Auth policy:
  PUBLIC  (no token needed):
    GET  /api/health
    POST /api/chat
    GET  /api/providers

  AUTHENTICATED (any valid JWT):
    POST /api/auth/login
    POST /api/auth/refresh
    POST /api/auth/logout
    GET  /api/auth/me

  ADMIN only:
    POST /api/knowledge              — ingest text document
    GET  /api/knowledge              — knowledge stats
    POST /api/knowledge/upload       — ingest uploaded file (pdf/docx/txt/md)
    GET  /api/knowledge/supported-types — list accepted file extensions
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status

from app.core.logging import get_logger
from app.core.settings import get_settings
from app.middleware.auth import require_auth
from app.models.schemas import (
    ChatRequest,
    ChatResponse,
    ErrorResponse,
    HealthResponse,
    IngestRequest,
    IngestResponse,
    JWTClaims,
    KnowledgeStats,
    LoginRequest,
    LLMProvider,
    ProviderStatus,
    PublicUser,
    TokenResponse,
)
from app.services.jwt_service import (
    REFRESH_COOKIE_NAME,
    clear_cookie_attrs,
    refresh_cookie_attrs,
    revoke_refresh_token,
    sign_token_pair,
    verify_refresh_token,
)
from app.services.llm_service import call_llm, get_default_provider
from app.services.rag_service import get_knowledge_stats, ingest_document, retrieve_context
from app.services.document_service import (
    extract_text,
    FileTooLarge,
    UnsupportedFileType,
    SUPPORTED_EXTENSIONS,
)
from app.services.user_service import find_by_id, to_public, verify_credentials

import asyncio

log = get_logger("api")
_start_time = time.time()


# ─────────────────────────────────────────────────────────────────────────────
# Auth router  (login/refresh/logout/me)
# ─────────────────────────────────────────────────────────────────────────────

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, response: Response):
    ip = request.headers.get("x-forwarded-for", "unknown").split(",")[0].strip()

    user = await verify_credentials(body.username, body.password)
    if not user:
        log.warning("login_failed", username=body.username, ip=ip)
        await asyncio.sleep(0.3)          # brute-force delay
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid username or password", "code": "INVALID_CREDENTIALS"},
        )

    cfg = get_settings()
    access_token, refresh_token = sign_token_pair(user.id, user.username, user.role)
    response.set_cookie(value=refresh_token, **refresh_cookie_attrs())

    log.info("login_success", username=user.username, role=user.role.value, ip=ip)
    return TokenResponse(
        access_token=access_token,
        expires_in=cfg.jwt_access_ttl_sec,
        user=to_public(user),
    )


@auth_router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Refresh token not found", "code": "MISSING_REFRESH_TOKEN"},
        )

    try:
        claims = verify_refresh_token(token)
    except ValueError as exc:
        response.set_cookie(value="", **clear_cookie_attrs())
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid or expired refresh token", "code": "INVALID_REFRESH_TOKEN"},
        )

    user = await find_by_id(claims.sub)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "User not found", "code": "USER_NOT_FOUND"},
        )

    revoke_refresh_token(token)
    cfg = get_settings()
    access_token, new_refresh = sign_token_pair(user.id, user.username, user.role)
    response.set_cookie(value=new_refresh, **refresh_cookie_attrs())

    log.info("token_refreshed", username=user.username)
    return TokenResponse(
        access_token=access_token,
        expires_in=cfg.jwt_access_ttl_sec,
        user=to_public(user),
    )


@auth_router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if token:
        try:
            verify_refresh_token(token)
            revoke_refresh_token(token)
        except ValueError:
            pass
    response.set_cookie(value="", **clear_cookie_attrs())
    return {"success": True}


@auth_router.get("/me", response_model=PublicUser)
async def me(claims: JWTClaims = Depends(require_auth())):
    user = await find_by_id(claims.sub)
    if not user:
        raise HTTPException(status_code=404, detail={"error": "User not found", "code": "NOT_FOUND"})
    return to_public(user)


# ─────────────────────────────────────────────────────────────────────────────
# Chat — PUBLIC, no authentication required
# ─────────────────────────────────────────────────────────────────────────────

chat_router = APIRouter(prefix="/api", tags=["chat"])


@chat_router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    """
    Send a message. No authentication required — open to all visitors.
    RAG context is injected automatically from the knowledge base.
    """
    t0       = time.perf_counter()
    provider = body.provider or get_default_provider()

    last_user_msg = next(
        (m.content for m in reversed(body.messages) if m.role.value == "user"),
        "",
    )
    chunks, context_text, _ = await retrieve_context(last_user_msg)
    system = _build_system_prompt(context_text)

    try:
        result = await call_llm(provider, body.messages, system)
    except Exception as exc:
        log.error("llm_error", session=body.session_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": str(exc), "code": "LLM_ERROR"},
        )

    latency = int((time.perf_counter() - t0) * 1000)
    log.info(
        "chat",
        session=body.session_id,
        provider=provider.value,
        context_chunks=len(chunks),
        tokens=result.tokens_used,
        latency_ms=latency,
    )
    return ChatResponse(
        reply=result.content,
        provider=provider,
        model=result.model,
        tokens_used=result.tokens_used,
        context_chunks=len(chunks),
        latency_ms=latency,
    )


def _build_system_prompt(context_text: str) -> str:
    base = (
        "You are an AI receptionist. Be helpful, professional, and concise. "
        "Answer based on the company knowledge base when available. "
        "If you don't know something, say so honestly. "
        "Keep responses under 150 words unless more detail is needed."
    )
    if not context_text.strip():
        return base
    return (
        f"{base}\n\n"
        "COMPANY KNOWLEDGE BASE:\n---\n"
        f"{context_text}\n"
        "---\nAnswer from the knowledge base above."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Knowledge — ADMIN only
# ─────────────────────────────────────────────────────────────────────────────

knowledge_router = APIRouter(prefix="/api", tags=["knowledge"])


@knowledge_router.post(
    "/knowledge",
    response_model=IngestResponse,
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
async def ingest(
    body: IngestRequest,
    claims: JWTClaims = Depends(require_auth("admin")),   # admin only
):
    try:
        n = await ingest_document(body.content, body.source, body.metadata)
    except Exception as exc:
        log.error("ingest_error", source=body.source, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Ingestion failed", "code": "INGEST_ERROR"},
        )
    log.info("knowledge_ingested", source=body.source, chunks=n, by=claims.username)
    return IngestResponse(success=True, chunks_created=n, source=body.source)


@knowledge_router.get(
    "/knowledge",
    response_model=KnowledgeStats,
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
async def knowledge_stats(claims: JWTClaims = Depends(require_auth("admin"))):
    stats = await get_knowledge_stats()
    return KnowledgeStats(**stats)


@knowledge_router.post(
    "/knowledge/upload",
    response_model=IngestResponse,
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
    },
)
async def upload(
    file: UploadFile = File(...),
    claims: JWTClaims = Depends(require_auth("admin")),   # admin only
):
    """
    Upload a document (.pdf, .docx, .txt, .md) for RAG ingestion.
    Admin only. Extracted text is chunked, embedded, and stored exactly
    like POST /api/knowledge — the source name is the uploaded filename.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "No filename provided", "code": "MISSING_FILENAME"},
        )

    data = await file.read()

    try:
        text = await extract_text(file.filename, data)
    except UnsupportedFileType as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": str(exc), "code": "UNSUPPORTED_FILE_TYPE"},
        )
    except FileTooLarge as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"error": str(exc), "code": "FILE_TOO_LARGE"},
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": str(exc), "code": "EMPTY_DOCUMENT"},
        )

    try:
        n = await ingest_document(
            text,
            file.filename,
            {"uploaded_by": claims.username, "content_type": file.content_type or ""},
        )
    except Exception as exc:
        log.error("upload_ingest_error", filename=file.filename, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Ingestion failed", "code": "INGEST_ERROR"},
        )

    log.info("file_uploaded_and_ingested", filename=file.filename, chunks=n, by=claims.username)
    return IngestResponse(success=True, chunks_created=n, source=file.filename)


@knowledge_router.get("/knowledge/supported-types")
async def supported_types(claims: JWTClaims = Depends(require_auth("admin"))):
    """List file extensions accepted by POST /api/knowledge/upload."""
    return {"extensions": sorted(SUPPORTED_EXTENSIONS)}


# ─────────────────────────────────────────────────────────────────────────────
# Providers — PUBLIC
# ─────────────────────────────────────────────────────────────────────────────

providers_router = APIRouter(prefix="/api", tags=["providers"])


@providers_router.get("/providers")
async def providers():
    """List available LLM providers. Public — used by the chat UI."""
    cfg     = get_settings()
    default = cfg.default_llm_provider
    return {
        "providers": [
            ProviderStatus(id=LLMProvider.deepseek,  label="DeepSeek",              model="deepseek-chat",           available=bool(cfg.deepseek_api_key),  is_default=default == "deepseek"),
            ProviderStatus(id=LLMProvider.anthropic, label="Anthropic (Claude Haiku)", model="claude-haiku-4-5-20251001", available=bool(cfg.anthropic_api_key), is_default=default == "anthropic"),
            ProviderStatus(id=LLMProvider.openai,    label="OpenAI",                model="gpt-4o-mini",             available=bool(cfg.openai_api_key),   is_default=default == "openai"),
        ],
        "default": default,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Health — PUBLIC
# ─────────────────────────────────────────────────────────────────────────────

health_router = APIRouter(prefix="/api", tags=["health"])


@health_router.get("/health", response_model=HealthResponse)
async def health():
    cfg   = get_settings()
    stats = await get_knowledge_stats()
    return HealthResponse(
        status="ok",
        version=cfg.app_version,
        uptime_seconds=int(time.time() - _start_time),
        vector_db=stats["index_ready"],
        knowledge_chunks=stats["total_chunks"],
        sources=stats["sources"],
        providers={
            "deepseek":  bool(cfg.deepseek_api_key),
            "anthropic": bool(cfg.anthropic_api_key),
            "openai":    bool(cfg.openai_api_key),
        },
        default_provider=cfg.default_llm_provider,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
