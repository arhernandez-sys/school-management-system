"""Shared FastAPI dependencies (architecture.md §6 core/deps.py).

`get_db`            — request-scoped SQLAlchemy session (commit/rollback handled
                      by the service layer; this just provides + closes it).
`get_current_user`  — verifies the Bearer access token, loads the live user row,
                      enforces is_active, and stashes user_id for request logging.
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
from app.core.errors import AccountInactive, Forbidden, Unauthenticated
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.modules.users.models import User

# auto_error=False so a missing header yields our normalized 401, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)


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
