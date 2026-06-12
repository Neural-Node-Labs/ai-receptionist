"""
User store — JSON file backed, bcrypt-hashed passwords.

Default admin is created on first boot from ADMIN_USERNAME / ADMIN_PASSWORD env vars.
Replace with SQLAlchemy + Postgres for production at scale.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

from passlib.context import CryptContext

from app.core.logging import get_logger
from app.core.settings import get_settings
from app.models.schemas import PublicUser, StoredUser, UserRole

log  = get_logger("users")
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

# ── In-memory cache ───────────────────────────────────────────────────────────

_users:      list[StoredUser] = []
_lock        = asyncio.Lock()
_initialised = False


async def _load() -> None:
    global _users, _initialised
    if _initialised:
        return

    cfg  = get_settings()
    path = Path(cfg.users_file)
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        try:
            raw    = path.read_text("utf-8")
            data   = json.loads(raw)
            _users = [StoredUser(**u) for u in data]
            log.info("user_store_loaded", count=len(_users))
            _initialised = True
            return
        except Exception as exc:
            log.error("user_store_load_failed", error=str(exc))

    # First boot — create admin from env
    admin_pass = cfg.require_admin_password()
    loop       = asyncio.get_event_loop()
    admin_hash = await loop.run_in_executor(None, _pwd.hash, admin_pass)

    admin = StoredUser(
        id            = str(uuid4()),
        username      = cfg.admin_username,
        password_hash = admin_hash,
        role          = UserRole.admin,
        created_at    = datetime.now(timezone.utc),
    )
    _users = [admin]
    await _persist()
    log.info("admin_user_created", username=cfg.admin_username)
    _initialised = True


async def _persist() -> None:
    cfg  = get_settings()
    path = Path(cfg.users_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = [u.model_dump(mode="json") for u in _users]
    path.write_text(json.dumps(data, indent=2, default=str), "utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

async def find_by_username(username: str) -> Optional[StoredUser]:
    async with _lock:
        await _load()
    return next((u for u in _users if u.username.lower() == username.lower()), None)


async def find_by_id(user_id: str) -> Optional[StoredUser]:
    async with _lock:
        await _load()
    return next((u for u in _users if u.id == user_id), None)


async def verify_credentials(username: str, password: str) -> Optional[StoredUser]:
    """
    Constant-time credential check.
    Always runs bcrypt even for unknown users to prevent timing-based
    username enumeration attacks.
    """
    async with _lock:
        await _load()

    user = next((u for u in _users if u.username.lower() == username.lower()), None)

    # Dummy hash ensures bcrypt runs regardless — same timing for unknown users
    dummy_hash = "$2b$12$invalidhashpaddingtopreventiumenumeration000000000000"
    check_hash = user.password_hash if user else dummy_hash

    loop  = asyncio.get_event_loop()
    valid = await loop.run_in_executor(None, _pwd.verify, password, check_hash)

    if not valid or not user:
        return None

    user.last_login_at = datetime.now(timezone.utc)
    async with _lock:
        await _persist()
    return user


def to_public(user: StoredUser) -> PublicUser:
    return PublicUser(
        id            = user.id,
        username      = user.username,
        role          = user.role,
        last_login_at = user.last_login_at,
    )


async def create_user(
    username: str,
    password: str,
    role: UserRole = UserRole.receptionist,
) -> PublicUser:
    async with _lock:
        await _load()
        if any(u.username.lower() == username.lower() for u in _users):
            raise ValueError(f"User '{username}' already exists")

        loop   = asyncio.get_event_loop()
        hashed = await loop.run_in_executor(None, _pwd.hash, password)

        new_user = StoredUser(
            id            = str(uuid4()),
            username      = username,
            password_hash = hashed,
            role          = role,
            created_at    = datetime.now(timezone.utc),
        )
        _users.append(new_user)
        await _persist()

    log.info("user_created", username=username, role=role.value)
    return to_public(new_user)


async def list_users() -> list[PublicUser]:
    async with _lock:
        await _load()
    return [to_public(u) for u in _users]
