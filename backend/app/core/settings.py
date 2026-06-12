"""
Application settings — loaded from environment variables at runtime.

Design rules:
  - All fields have defaults so Pydantic never fails at import/class-instantiation time.
  - Required secrets (JWT keys, admin password) default to None and are validated
    LAZILY inside get_settings() after the class is constructed.
  - get_settings() is cached with @lru_cache — validation runs exactly once.
  - Secrets are NEVER logged or included in repr.
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # Never expose secret values in repr / logs
        hide_input_in_errors=True,
    )

    # ── App ──────────────────────────────────────────────────────────────────
    app_version:  str  = "1.0.0"
    debug:        bool = False
    log_level:    str  = "INFO"
    port:         int  = 3001
    frontend_url: str  = "http://localhost:3000"

    # ── LLM ──────────────────────────────────────────────────────────────────
    deepseek_api_key:     Optional[str] = None
    anthropic_api_key:    Optional[str] = None
    openai_api_key:       Optional[str] = None
    default_llm_provider: str = "deepseek"

    # ── Auth / JWT — Optional so Pydantic never fails at import time ──────────
    # Validated in get_settings() after construction.
    jwt_access_secret:   Optional[str] = None
    jwt_refresh_secret:  Optional[str] = None
    jwt_access_ttl_sec:  int = 900       # 15 min
    jwt_refresh_ttl_sec: int = 604_800   # 7 days
    jwt_algorithm:       str = "HS256"

    # ── Admin user — Optional for same reason ─────────────────────────────────
    admin_username: str           = "admin"
    admin_password: Optional[str] = None

    # ── RAG / Storage ─────────────────────────────────────────────────────────
    vector_db_path: str = "/app/data/vectordb"
    hf_home:        str = "/app/data/models"
    data_path:      str = "/app/data"

    # ── Rate limiting ─────────────────────────────────────────────────────────
    rate_limit_global: str = "30/minute"
    rate_limit_auth:   str = "5/minute"
    rate_limit_ingest: str = "10/minute"

    # ── Derived properties (never raise) ─────────────────────────────────────

    @property
    def cors_origins(self) -> list[str]:
        return list({
            self.frontend_url,
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        })

    @property
    def users_file(self) -> str:
        return f"{self.data_path}/users.json"

    @property
    def is_production(self) -> bool:
        env = os.getenv("ENV", os.getenv("NODE_ENV", "development")).lower()
        return env == "production"

    @property
    def has_any_llm_key(self) -> bool:
        return bool(self.deepseek_api_key or self.anthropic_api_key or self.openai_api_key)

    # ── Helpers for safe access to required secrets ───────────────────────────

    def require_jwt_access_secret(self) -> str:
        if not self.jwt_access_secret:
            _fatal("JWT_ACCESS_SECRET")
        return self.jwt_access_secret  # type: ignore[return-value]

    def require_jwt_refresh_secret(self) -> str:
        if not self.jwt_refresh_secret:
            _fatal("JWT_REFRESH_SECRET")
        return self.jwt_refresh_secret  # type: ignore[return-value]

    def require_admin_password(self) -> str:
        if not self.admin_password:
            _fatal("ADMIN_PASSWORD")
        return self.admin_password  # type: ignore[return-value]


def _fatal(var: str) -> None:
    """Print a clear error and exit — better than a cryptic traceback."""
    print(
        f"\n[FATAL] Required environment variable '{var}' is not set.\n"
        f"  Copy .env.example to .env and fill in all required values.\n"
        f"  See README.md for setup instructions.\n",
        file=sys.stderr,
    )
    sys.exit(1)


def _validate_settings(cfg: Settings) -> None:
    """
    Runtime validation — called once from get_settings().
    Validates presence and strength of required secrets.
    Exits with a clear message instead of a cryptic Pydantic traceback.
    """
    errors: list[str] = []

    # Required fields
    for name, val in [
        ("JWT_ACCESS_SECRET",  cfg.jwt_access_secret),
        ("JWT_REFRESH_SECRET", cfg.jwt_refresh_secret),
        ("ADMIN_PASSWORD",     cfg.admin_password),
    ]:
        if not val or not val.strip():
            errors.append(f"  • {name} is required but not set")
            continue

        # Minimum length for JWT secrets
        if "SECRET" in name and len(val) < 32:
            errors.append(f"  • {name} must be at least 32 characters (got {len(val)})")

        # Block obvious placeholder values in production
        if cfg.is_production:
            bad = ("build-placeholder", "CHANGE_ME", "changeme", "dev_", "example", "secret123")
            if any(val.lower().startswith(b.lower()) for b in bad):
                errors.append(f"  • {name} uses a placeholder value — set a real secret in production")

    if errors:
        print("\n[FATAL] Configuration errors:\n" + "\n".join(errors), file=sys.stderr)
        print("\n  Copy .env.example to .env and set the required values.\n", file=sys.stderr)
        sys.exit(1)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Build, validate, and cache the settings singleton.
    Called at runtime (first API request or lifespan startup), NOT at import time.
    """
    cfg = Settings()
    _validate_settings(cfg)
    return cfg
