"""
AI Receptionist — FastAPI application entry point.

Middleware execution order (Starlette LIFO — last added = outermost):
  1. CORS            ← outermost: preflight + ACAO header on ALL responses
  2. Security headers ← every response including 4xx/5xx
  3. Request logging
  4. Routes / handlers

IMPORTANT: get_settings() is NOT called at import time.
It is called inside lifespan() so Docker env vars are fully available
before any validation runs.
"""

from __future__ import annotations
from pathlib import Path
import time
from contextlib import asynccontextmanager
import traceback
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from app.services import rag_service
from app.api.routes import (
    auth_router,
    chat_router,
    health_router,
    knowledge_router,
    providers_router,
)
from app.core.logging import configure_logging, get_logger

# ── Rate limiter (no settings needed at import time) ─────────────────────────

limiter = Limiter(key_func=get_remote_address, default_limits=["30/minute"])


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # get_settings() is called HERE — after uvicorn has fully started and
    # all environment variables injected by Docker are available.
    from app.core.settings import get_settings          # local import is intentional
    from app.services.rag_service import (
            warmup,
            get_knowledge_stats,
            delete_source,
            ingest_document
        )
    from app.services.user_service import find_by_username

    cfg = get_settings()                                # validates secrets; exits on error
    configure_logging(cfg.log_level)
    log = get_logger("startup")

    log.info("starting", version=cfg.app_version, port=cfg.port)

    if not cfg.has_any_llm_key:
        log.warning("no_llm_keys_configured — set DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY")

    # First-boot admin creation + vector index warm-up
    await find_by_username(cfg.admin_username)
    await warmup()

# ── Automatic Data Ingestion ──────────────────────────────────────────────
    data_file = Path("/app/app/data.md")  # Adjust this path if data.md is in a subdirectory (e.g., Path("app/data.md"))
    log.info("data_file: ", data_file)
    if data_file.exists():
        try:

            source_name = data_file.name

            # 1. Remove old chunks for this source if they exist
            log.info("startup_clearing_existing_data", source=source_name)
            chunks_removed = await delete_source(source=source_name)

            if chunks_removed > 0:
                log.info("startup_old_data_purged", source=source_name, count=chunks_removed)


            # 2. Ingest the fresh file content
            log.info("startup_ingestion_started", source=source_name)
            content = data_file.read_text(encoding="utf-8")

            chunks_created = await ingest_document(
                content=content,
                source=source_name,
                metadata={"category": "system_bootstrap"}
            )
            log.info("startup_ingestion_success", source=source_name, chunks=chunks_created)

        except Exception as exc:
            traceback.print_stack()
            log.error("startup_reingestion_failed", error=str(exc))
    else:
        log.warning("startup_ingestion_skipped", reason="file_not_found", path=str(data_file))
    # ─────────────────────────────────────────────────────────────────────────

    log.info("ready")
    yield
    log.info("shutdown")


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    """
    Build the FastAPI application.
    Does NOT call get_settings() — settings are read lazily inside lifespan
    and inside route handlers (cached after first call).
    """
    app = FastAPI(
        title="AI Receptionist API",
        version="1.0.0",
        # Docs disabled at module level; re-enabled in lifespan if debug=True
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    # ── Rate limiting ─────────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(chat_router)
    app.include_router(knowledge_router)
    app.include_router(providers_router)

    # ── Global exception handler ──────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_handler(request: Request, exc: Exception) -> JSONResponse:
        get_logger("error").error(
            "unhandled_exception",
            path=request.url.path,
            error=str(exc),
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "code": "INTERNAL_ERROR"},
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Middleware — registered in REVERSE execution order (Starlette LIFO).
    # Last add_middleware() call = outermost = runs first on request.
    # ─────────────────────────────────────────────────────────────────────────

    # 3. Innermost: request logging
    @app.middleware("http")
    async def request_log(request: Request, call_next) -> Response:
        t0       = time.perf_counter()
        response = await call_next(request)
        ms       = int((time.perf_counter() - t0) * 1000)
        if request.url.path != "/api/health":
            get_logger("http").info(
                "request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                latency_ms=ms,
            )
        return response

    # 2. Security headers (wraps every response)
    @app.middleware("http")
    async def security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"]  = "nosniff"
        response.headers["X-Frame-Options"]          = "DENY"
        response.headers["X-XSS-Protection"]         = "1; mode=block"
        response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"]        = "camera=(), microphone=(), geolocation=()"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )
        return response

    # 1. Outermost: CORS — added LAST so it wraps all middleware above.
    #    This guarantees Access-Control-* headers appear on every response,
    #    including 401, 403, 422, 500 — which is what browsers need.
    #
    #    allow_origins is read from settings at first request (cached).
    #    We use a wildcard-safe origin list; credentials require explicit origin.
    # Read FRONTEND_URL at app-creation time via os.getenv (not get_settings()).
    # This avoids any import-time Settings() instantiation.
    import os as _os
    _extra = _os.getenv("FRONTEND_URL", "http://localhost:3000")
    _origins = list({"http://localhost:3000", "http://127.0.0.1:3000", _extra})

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["X-RateLimit-Remaining"],
        max_age=600,
    )

    return app


# Module-level app object — created without reading settings.
app = create_app()
