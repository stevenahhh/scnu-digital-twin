"""Lightweight account login shared by the weather and simulation services.

Reads stay public; every other HTTP method needs an admin token. Tokens are
stateless HMAC-SHA256 signed payloads. The signing secret comes from
``SCNU_AUTH_SECRET`` or, when unset, from a git-ignored key file at the
repository root (``SCNU_AUTH_SECRET_FILE`` overrides its path) so both
processes share it without configuration.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import HTTPException
from starlette.requests import HTTPConnection

Role = Literal["student", "admin"]

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_KEY_FILE = _REPO_ROOT / ".scnu-auth-secret"
_PBKDF2_ITERATIONS = 200_000
_PUBLIC_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_LOGIN_PATHS = frozenset({"/auth/login", "/auth/guest"})

LOGIN_FAILED = "아이디 또는 비밀번호가 올바르지 않습니다"
LOGIN_REQUIRED = "로그인이 필요합니다"
ADMIN_REQUIRED = "관리자 권한이 필요합니다"
GUEST_DISABLED = "게스트 로그인이 꺼져 있습니다"


@dataclass(frozen=True, slots=True)
class Account:
    id: str
    name: str
    role: Role
    guest: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class _SeedAccount:
    account: Account
    salt_hex: str
    hash_hex: str


# Seed accounts: PBKDF2-HMAC-SHA256 digests with per-account salts, never plain passwords.
_SEED_ACCOUNTS: dict[str, _SeedAccount] = {
    "20239901": _SeedAccount(
        Account("20239901", "학생", "student"),
        "dba3665aab3671859bdf44946087b577",
        "626cfd1de798d63f55ad81832f19ac47d4a4e4451bcef3bcf3640ab745614ed1",
    ),
    "admin": _SeedAccount(
        Account("admin", "관리자", "admin"),
        "f9ce17901143798e9d8fd05ff11cfaaf",
        "e3c753826ddd27e7c406c8901e7c68fe2cfd89a9a15da022505291410213a456",
    ),
}


def authenticate(account_id: str, password: str) -> Optional[Account]:
    seed = _SEED_ACCOUNTS.get(account_id)
    if seed is None:
        return None
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 bytes.fromhex(seed.salt_hex), _PBKDF2_ITERATIONS)
    return seed.account if hmac.compare_digest(digest.hex(), seed.hash_hex) else None


def guest_account(role: Role) -> Account:
    return Account(f"guest-{role}", "게스트", role, guest=True)


def guest_enabled() -> bool:
    return os.getenv("SCNU_AUTH_GUEST_ENABLED", "1").strip().lower() not in {"0", "false"}


def _secret() -> bytes:
    configured = os.getenv("SCNU_AUTH_SECRET")
    if configured:
        return configured.encode("utf-8")
    path = Path(os.getenv("SCNU_AUTH_SECRET_FILE") or _DEFAULT_KEY_FILE)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return path.read_text(encoding="utf-8").strip().encode("utf-8")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(secrets.token_hex(32))
    return path.read_text(encoding="utf-8").strip().encode("utf-8")


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(account: Account) -> dict:
    expires = int(time.time()) + int(os.getenv("SCNU_AUTH_TOKEN_TTL_S", "43200"))
    payload = _b64encode(json.dumps({**account.as_dict(), "exp": expires},
                                    ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    signature = _b64encode(hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).digest())
    return {
        "token": f"{payload}.{signature}",
        "token_type": "bearer",
        "expires_at": datetime.fromtimestamp(expires, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "account": account.as_dict(),
    }


def verify_token(token: str) -> Optional[Account]:
    payload, _, signature = token.partition(".")
    try:
        expected = hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64decode(signature), expected):
            return None
        claims = json.loads(_b64decode(payload))
    except ValueError:
        return None
    if claims["exp"] <= time.time():
        return None
    return Account(claims["id"], claims["name"], claims["role"], claims["guest"])


def _bearer_account(connection: HTTPConnection) -> Optional[Account]:
    scheme, _, token = connection.headers.get("authorization", "").partition(" ")
    return verify_token(token.strip()) if scheme.lower() == "bearer" and token.strip() else None


def _login_required() -> HTTPException:
    return HTTPException(status_code=401, detail=LOGIN_REQUIRED, headers={"WWW-Authenticate": "Bearer"})


def current_account(connection: HTTPConnection) -> Account:
    account = _bearer_account(connection)
    if account is None:
        raise _login_required()
    return account


def require_admin_for_writes(connection: HTTPConnection) -> None:
    """App-wide FastAPI dependency: reads and WebSockets are public, writes need admin."""
    if connection.scope["type"] != "http":
        return
    if connection.scope["method"] in _PUBLIC_METHODS or connection.url.path in _LOGIN_PATHS:
        return
    if current_account(connection).role != "admin":
        raise HTTPException(status_code=403, detail=ADMIN_REQUIRED)
