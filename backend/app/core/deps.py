"""Shared FastAPI dependencies (architecture.md §6 core/deps.py).

`get_db`            — request-scoped SQLAlchemy session (commit/rollback handled
                      by the service layer; this just provides + closes it).
`get_current_user`  — verifies the Bearer access token, loads the live user row,
                      enforces is_active AND the forced password change, and stashes
                      user_id for request logging.
`require_role(...)` — coarse role gate (architecture §3.2 layer 1).
"""

from __future__ import annotations

from collections.abc import Iterator

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.core.errors import (
    AccountInactive,
    Forbidden,
    PasswordChangeRequired,
    Unauthenticated,
)
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.modules.users.models import User

# auto_error=False so a missing header yields our normalized 401, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)

#: (method, path suffix) pairs a user with `must_change_password` may still reach.
#:
#: Everything else is refused with 403 `password_change_required`. Before D31 Phase 5
#: the flag was WRITTEN by four paths (the bootstrap seed, admissions acceptance, the
#: Dean's reset, user creation) and returned on `CurrentUser`, but NO server path read
#: it — enforcement was a single client redirect in `LoginForm.tsx`, so a deep link, a
#: stale tab or any API client with a valid token walked straight past it.
#:
#: Each exemption earns its place:
#:   * `PATCH /auth/me/password` is the way OUT of the state. Gating it would lock the
#:     account out of the only action that clears the flag.
#:   * `GET /auth/me` is how the client LEARNS about the flag. The frontend's bootstrap
#:     is refresh-then-/me, so refusing it would drop a reloading user to anonymous and
#:     the forced-change screen would lose the very fact it branches on. It returns the
#:     caller's own identity and preferences and no school data.
#:   * `POST /auth/logout` — walking away must always be possible.
#:
#: `/auth/login` and `/auth/refresh` are absent because neither depends on
#: `get_current_user`; they authenticate by password / refresh cookie instead. Both
#: deliberately still SUCCEED for a flagged account: the flag reaches the client on
#: their `user` payload, which is what the forced-change flow reads.
_FORCED_CHANGE_EXEMPT: frozenset[tuple[str, str]] = frozenset(
    {
        ("PATCH", "/auth/me/password"),
        ("GET", "/auth/me"),
        ("POST", "/auth/logout"),
    }
)


def _is_forced_change_exempt(request: Request) -> bool:
    """Whether this request is one of the three a flagged account may still make.

    Matched on the REQUEST PATH's suffix rather than on the router prefix, so it holds
    whether the app is mounted at `/api/v1` (main.py) or bare (a unit test building its
    own app). The method is part of the key: `GET /auth/me` is exempt, but a `PATCH`
    to the same path is a preferences write and is not.
    """
    path = request.url.path.rstrip("/") or "/"
    return any(
        request.method == method and path.endswith(suffix)
        for method, suffix in _FORCED_CHANGE_EXEMPT
    )


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None or not creds.credentials:
        raise Unauthenticated("Authentication required.")
    try:
        claims = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise Unauthenticated("Access token expired.") from exc
    except jwt.PyJWTError as exc:
        raise Unauthenticated("Invalid access token.") from exc

    user_id = claims.get("sub")
    user = db.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    if user is None:
        raise Unauthenticated("Account not found.")
    if not user.is_active:
        # A token issued before deactivation must not grant access.
        raise AccountInactive("This account is inactive.")
    if user.must_change_password and not _is_forced_change_exempt(request):
        # The token is valid; the account simply is not cleared for anything else
        # until the temporary password has been replaced (see _FORCED_CHANGE_EXEMPT).
        raise PasswordChangeRequired(
            "You must change your password before continuing."
        )

    # For structured request logging (logging.py reads request.state.user_id).
    request.state.user_id = str(user.id)
    return user


def require_role(*roles: Role):
    """Return a dependency that allows only the given roles (architecture §3.2)."""
    allowed = set(roles)

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise Forbidden("You do not have access to this resource.")
        return user

    return _checker
