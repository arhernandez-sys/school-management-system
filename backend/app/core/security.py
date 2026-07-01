"""Security primitives (architecture.md §3.1, api-spec §2.1).

 - Argon2id password hashing/verification (NFR-SEC-03).
 - JWT access-token encode/decode (HS256), claims: sub, role, exp, iat, jti.
 - Refresh-token generation + SHA-256 hashing (the refresh_sessions store keeps
   only the hash; the raw token lives solely in the HttpOnly cookie).
 - A strong temporary-password generator for admin resets / seed.

NEVER logs or returns raw secrets except where the contract requires returning a
generated temporary password exactly once (reset-password endpoint).
"""

from __future__ import annotations

import hashlib
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc

from app.config import Settings, get_settings

_settings = get_settings()

# Argon2id is the default `type` for argon2-cffi's PasswordHasher.
_hasher = PasswordHasher(
    time_cost=_settings.argon2_time_cost,
    memory_cost=_settings.argon2_memory_cost,
    parallelism=_settings.argon2_parallelism,
)


# ── Password hashing ────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time-ish verify. Returns False on any mismatch/invalid hash; never
    raises to the caller (non-enumerating)."""
    try:
        return _hasher.verify(hashed, plain)
    except (argon2_exc.VerifyMismatchError, argon2_exc.InvalidHashError, Exception):
        return False


def needs_rehash(hashed: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hashed)
    except Exception:
        return False


# ── Token hashing (refresh store) ────────────────────────────────────────────────
def sha256_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── JWT access tokens ─────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def create_access_token(
    *,
    user_id: uuid.UUID,
    role: str,
    settings: Settings | None = None,
) -> str:
    cfg = settings or _settings
    now = _now()
    claims = {
        "sub": str(user_id),
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=cfg.jwt_access_ttl)).timestamp()),
        "jti": str(uuid.uuid4()),
        "typ": "access",
    }
    return jwt.encode(claims, cfg.jwt_secret, algorithm=cfg.jwt_algorithm)


def decode_access_token(token: str, *, settings: Settings | None = None) -> dict:
    """Decode + verify signature/expiry. Raises jwt exceptions on failure (the
    caller maps to Unauthenticated)."""
    cfg = settings or _settings
    return jwt.decode(
        token,
        cfg.jwt_secret,
        algorithms=[cfg.jwt_algorithm],
        options={"require": ["exp", "iat", "sub"]},
    )


# ── Refresh tokens (opaque random, stored hashed, keyed by jti) ───────────────────
def new_refresh_token() -> tuple[uuid.UUID, str, str]:
    """Return (jti, raw_token, token_hash).

    The raw token is a high-entropy URL-safe string sent only in the cookie. The
    refresh_sessions row stores the jti (as its PK) and the SHA-256 hash. We bind
    the jti into the raw token so logout/refresh can locate the row by jti without
    a table scan: token = "<jti>.<secret>".
    """
    jti = uuid.uuid4()
    secret_part = secrets.token_urlsafe(48)
    raw = f"{jti}.{secret_part}"
    return jti, raw, sha256_hash(raw)


def parse_refresh_jti(raw_token: str) -> uuid.UUID | None:
    """Extract the jti prefix from a presented refresh token, if well-formed."""
    head, _, _ = raw_token.partition(".")
    try:
        return uuid.UUID(head)
    except (ValueError, AttributeError):
        return None


# ── Temporary password generation (admin reset / seed) ─────────────────────────────
def generate_temp_password(length: int = 16) -> str:
    """Generate a strong temporary password meeting the policy (mixed classes)."""
    alphabet = string.ascii_letters + string.digits
    punct = "!@#$%^&*-_"
    while True:
        pw = "".join(secrets.choice(alphabet + punct) for _ in range(length))
        if (
            any(c.islower() for c in pw)
            and any(c.isupper() for c in pw)
            and any(c.isdigit() for c in pw)
            and any(c in punct for c in pw)
        ):
            return pw


def validate_password_policy(pw: str, *, settings: Settings | None = None) -> list[str]:
    """Return a list of human-readable policy violations (empty = valid).
    FR-AUTH-09: min length + complexity, server-validated."""
    cfg = settings or _settings
    errors: list[str] = []
    if len(pw) < cfg.password_min_length:
        errors.append(f"Must be at least {cfg.password_min_length} characters.")
    if not any(c.isupper() for c in pw):
        errors.append("Must contain an uppercase letter.")
    if not any(c.islower() for c in pw):
        errors.append("Must contain a lowercase letter.")
    if not any(c.isdigit() for c in pw):
        errors.append("Must contain a digit.")
    return errors
