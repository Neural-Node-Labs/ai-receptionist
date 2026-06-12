"""
Pydantic v2 models — snake_case Python, camelCase JSON (for frontend compatibility).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Base with camelCase JSON ──────────────────────────────────────────────────

class CamelModel(BaseModel):
    """Base model: Python uses snake_case, JSON output uses camelCase."""
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=lambda s: "".join(
            w.capitalize() if i else w for i, w in enumerate(s.split("_"))
        ),
        ser_model_by_alias=True,   # JSON output uses camelCase
    )


# ── Enums ─────────────────────────────────────────────────────────────────────

class LLMProvider(str, Enum):
    deepseek  = "deepseek"
    anthropic = "anthropic"
    openai    = "openai"


class UserRole(str, Enum):
    admin        = "admin"
    receptionist = "receptionist"
    viewer       = "viewer"


class MessageRole(str, Enum):
    user      = "user"
    assistant = "assistant"
    system    = "system"


# ── Chat ──────────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role:    MessageRole
    content: str = Field(min_length=1, max_length=4096)


class ChatRequest(BaseModel):
    messages:   list[Message] = Field(min_length=1, max_length=20)
    provider:   Optional[LLMProvider] = None
    session_id: str = Field(alias="sessionId", min_length=1, max_length=64,
                            pattern=r"^[a-zA-Z0-9_-]+$")
    stream:     bool = False
    model_config = ConfigDict(populate_by_name=True)


class ChatResponse(CamelModel):
    reply:          str
    provider:       LLMProvider
    model:          str
    tokens_used:    int = 0
    context_chunks: int = 0
    latency_ms:     int = 0


# ── Knowledge ─────────────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    content:  str = Field(min_length=10, max_length=100_000)
    source:   str = Field(min_length=1, max_length=256, pattern=r"^[a-zA-Z0-9 _\-./]+$")
    metadata: dict[str, str] = Field(default_factory=dict)


class IngestResponse(CamelModel):
    success:        bool
    chunks_created: int
    source:         str


class KnowledgeChunk(BaseModel):
    id:       str
    content:  str
    source:   str
    metadata: dict[str, str]
    score:    Optional[float] = None


class KnowledgeStats(CamelModel):
    total_chunks: int
    sources:      list[str]
    index_ready:  bool


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_.\-]+$")
    password: str = Field(min_length=1, max_length=256)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.\-]+$")
    password: str = Field(min_length=12, max_length=256)
    role:     UserRole = UserRole.receptionist

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain an uppercase letter")
        if not any(c.islower() for c in v):
            raise ValueError("Password must contain a lowercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain a digit")
        return v


class PublicUser(CamelModel):
    id:            str
    username:      str
    role:          UserRole
    last_login_at: Optional[datetime] = None


class TokenResponse(CamelModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int
    user:         PublicUser


class StoredUser(BaseModel):
    id:            str
    username:      str
    password_hash: str
    role:          UserRole
    created_at:    datetime
    last_login_at: Optional[datetime] = None


# ── JWT ───────────────────────────────────────────────────────────────────────

class JWTClaims(BaseModel):
    sub:      str
    username: str
    role:     UserRole
    type:     Literal["access", "refresh"]
    iat:      Optional[int] = None
    exp:      Optional[int] = None


# ── Health ────────────────────────────────────────────────────────────────────

class ProviderStatus(CamelModel):
    id:         LLMProvider
    label:      str
    model:      str
    available:  bool
    is_default: bool


class HealthResponse(CamelModel):
    status:           str
    version:          str
    uptime_seconds:   int
    vector_db:        bool
    knowledge_chunks: int
    sources:          list[str]
    providers:        dict[str, bool]
    default_provider: str
    timestamp:        str


# ── Error ─────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    error: str
    code:  str
