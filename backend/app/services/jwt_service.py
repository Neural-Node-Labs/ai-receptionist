"""
JWT service — access + refresh token lifecycle.

Access token:  HS256, 15 min, Bearer header
Refresh token: HS256, 7 days, httpOnly cookie (Path=/api/auth)
Rotation:      old refresh token is revoked on every use
Revocation:    in-memory set (replace with Redis for multi-replica)
"""

from __future__ import annotations

import os
import time
from typing import Literal, Optional

from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError

from app.core.settings import get_settings
from app.models.schemas import JWTClaims, UserRole

# ── Revocation set ────────────────────────────────────────────────────────────

_revoked: set[str] = set()


def _prune_revoked() -> None:
    cfg = get_settings()
    to_remove = []
    for token in _revoked:
        try:
            jwt.decode(
                token, cfg.require_jwt_refresh_secret(),
                algorithms=[cfg.jwt_algorithm],
                options={"verify_exp": True},
            )
        except (JWTError, ExpiredSignatureError):
            to_remove.append(token)
    for t in to_remove:
        _revoked.discard(t)


# ── Environment helper ────────────────────────────────────────────────────────

def _is_https() -> bool:
    """
    True only when running in production behind TLS.
    On http://localhost, Secure cookies are silently dropped by browsers.
    """
    env   = os.getenv("ENV", os.getenv("NODE_ENV", "development")).lower()
    force = os.getenv("FORCE_HTTPS", "").lower()
    if force == "true":
        return True
    if force == "false":
        return False
    return env == "production"


# ── Sign ──────────────────────────────────────────────────────────────────────

def _sign(
    user_id: str,
    username: str,
    role: UserRole,
    token_type: Literal["access", "refresh"],
) -> str:
    cfg    = get_settings()
    secret = cfg.require_jwt_access_secret()  if token_type == "access" \
             else cfg.require_jwt_refresh_secret()
    ttl    = cfg.jwt_access_ttl_sec  if token_type == "access" \
             else cfg.jwt_refresh_ttl_sec
    now    = int(time.time())
    claims = {
        "sub":      user_id,
        "username": username,
        "role":     role.value,
        "type":     token_type,
        "iat":      now,
        "exp":      now + ttl,
        "iss":      "ai-receptionist",
        "aud":      "ai-receptionist-ui",
    }
    return jwt.encode(claims, secret, algorithm=cfg.jwt_algorithm)


def sign_access_token(user_id: str, username: str, role: UserRole) -> str:
    return _sign(user_id, username, role, "access")


def sign_refresh_token(user_id: str, username: str, role: UserRole) -> str:
    return _sign(user_id, username, role, "refresh")


def sign_token_pair(user_id: str, username: str, role: UserRole) -> tuple[str, str]:
    """Return (access_token, refresh_token)."""
    return sign_access_token(user_id, username, role), \
           sign_refresh_token(user_id, username, role)


# ── Verify ────────────────────────────────────────────────────────────────────

def _decode(token: str, token_type: Literal["access", "refresh"]) -> JWTClaims:
    cfg    = get_settings()
    secret = cfg.require_jwt_access_secret()  if token_type == "access" \
             else cfg.require_jwt_refresh_secret()
    try:
        payload = jwt.decode(
            token, secret,
            algorithms=[cfg.jwt_algorithm],
            issuer="ai-receptionist",
            audience="ai-receptionist-ui",
        )
    except ExpiredSignatureError:
        raise ValueError("Token has expired")
    except JWTError as exc:
        raise ValueError(f"Invalid token: {exc}") from exc

    if payload.get("type") != token_type:
        raise ValueError(f"Token type mismatch: expected {token_type}")
    return JWTClaims(**payload)


def verify_access_token(token: str) -> JWTClaims:
    return _decode(token, "access")


def verify_refresh_token(token: str) -> JWTClaims:
    if token in _revoked:
        raise ValueError("Refresh token has been revoked")
    return _decode(token, "refresh")


# ── Revoke ────────────────────────────────────────────────────────────────────

def revoke_refresh_token(token: str) -> None:
    _revoked.add(token)
    if len(_revoked) % 100 == 0:
        _prune_revoked()


# ── Cookie helpers ────────────────────────────────────────────────────────────

REFRESH_COOKIE_NAME = "rft"


def refresh_cookie_attrs(max_age: Optional[int] = None) -> dict:
    """
    Cookie attributes for Response.set_cookie(**refresh_cookie_attrs()).

    secure=False on http://localhost — browsers silently drop Secure cookies
    on plain HTTP, so the refresh flow would always fail in development.
    """
    cfg = get_settings()
    return {
        "key":      REFRESH_COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "secure":   _is_https(),
        "path":     "/api/auth",
        "max_age":  max_age if max_age is not None else cfg.jwt_refresh_ttl_sec,
    }


def clear_cookie_attrs() -> dict:
    return {
        "key":      REFRESH_COOKIE_NAME,
        "value":    "",
        "httponly": True,
        "samesite": "lax",
        "secure":   _is_https(),
        "path":     "/api/auth",
        "max_age":  0,
    }
