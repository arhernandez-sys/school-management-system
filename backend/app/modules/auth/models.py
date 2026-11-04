"""Auth session/token store (database-schema.md §3.A).

Server-side refresh-token store (architecture §3.1, D13) enabling revocation +
idle-timeout that a stateless JWT cannot. Plus the admin-reset token table and the
append-only login-attempts log backing brute-force throttling.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk
from app.db.types import GUID


class RefreshSession(Base, TimestampMixin):
    __tablename__ = "refresh_sessions"

    # PK is also the token's jti.
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_refresh_sessions_user"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(Text(), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_revoked: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    user_agent: Mapped[str | None] = mapped_column(Text(), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    __table_args__ = (
        Index("uq_refresh_sessions_token_hash", "token_hash", unique=True),
        Index(
            "ix_refresh_sessions_user",
            "user_id",
            postgresql_where=text("is_revoked = false"),
        ),
    )


class PasswordResetToken(Base, TimestampMixin):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_pwreset_user"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(Text(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_pwreset_creator"),
        nullable=True,
    )

    __table_args__ = (
        Index("uq_pwreset_token_hash", "token_hash", unique=True),
    )


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[uuid.UUID] = uuid_pk()
    email_attempted: Mapped[str] = mapped_column(String(254), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_login_attempts_user"),
        nullable=True,
    )
    succeeded: Mapped[bool] = mapped_column(Boolean(), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
