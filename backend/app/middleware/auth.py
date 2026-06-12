"""
FastAPI auth middleware — JWT Bearer dependency + RBAC.

Usage:
    @router.get("/protected")
    async def handler(claims: JWTClaims = Depends(require_auth())):
        ...

    # Require minimum role:
    @router.post("/admin-only")
    async def handler(claims: JWTClaims = Depends(require_auth("admin"))):
        ...
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.logging import get_logger
from app.models.schemas import JWTClaims, UserRole
from app.services.jwt_service import verify_access_token

log    = get_logger("auth")
bearer = HTTPBearer(auto_error=False)

# Role hierarchy
_ROLE_RANK: dict[UserRole, int] = {
    UserRole.viewer:       0,
    UserRole.receptionist: 1,
    UserRole.admin:        2,
}


def _extract_claims(
    credentials: Optional[HTTPAuthorizationCredentials],
) -> JWTClaims:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Missing Bearer token", "code": "MISSING_TOKEN"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        return verify_access_token(token)
    except ValueError as exc:
        msg = str(exc)
        is_expired = "expired" in msg.lower()
        log.warning("token_verify_failed", reason=msg)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "Token expired" if is_expired else "Invalid token",
                "code":  "TOKEN_EXPIRED" if is_expired else "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_auth(min_role: Optional[str] = None):
    """
    FastAPI dependency factory.
    min_role: "viewer" | "receptionist" | "admin" | None (any authenticated)
    """
    async def dependency(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    ) -> JWTClaims:
        claims = _extract_claims(credentials)

        if min_role:
            required_rank = _ROLE_RANK.get(UserRole(min_role), 0)
            actual_rank   = _ROLE_RANK.get(claims.role, -1)
            if actual_rank < required_rank:
                log.warning(
                    "insufficient_role",
                    required=min_role,
                    actual=claims.role,
                    user=claims.username,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"error": "Insufficient permissions", "code": "FORBIDDEN"},
                )

        return claims

    return dependency
