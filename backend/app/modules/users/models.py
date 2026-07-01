"""Users / account store + per-user preferences (database-schema.md §3.A).

`users` is the authentication principal (one role per user, A-ONE-ROLE).
`user_preferences` is 1:1 with users and sources the `preferences` block of
CurrentUser (api-spec §4.4).

Student/Teacher *profiles* live in their own modules (students/, teachers/) and
hold the user_id linkage FK; defined there to keep module boundaries clean.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.enums import Role
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import pg_enum


class User(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(CITEXT(), nullable=False)
    username: Mapped[str | None] = mapped_column(CITEXT(), nullable=True)
    password_hash: Mapped[str] = mapped_column(Text(), nullable=False)
    role: Mapped[Role] = mapped_column(pg_enum(Role), nullable=False)
    full_name: Mapped[str] = mapped_column(Text(), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )
    must_change_password: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    failed_login_count: Mapped[int] = mapped_column(
        SmallInteger(), nullable=False, server_default=text("0")
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    preferences: Mapped["UserPreferences | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_users_email",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_users_username",
            "username",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND username IS NOT NULL"),
        ),
        CheckConstraint("failed_login_count >= 0", name="ck_users_failed_login_nonneg"),
    )


class UserPreferences(Base, TimestampMixin):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_user_preferences_user"),
        primary_key=True,
    )
    locale: Mapped[str] = mapped_column(Text(), nullable=False, server_default=text("'en'"))
    theme: Mapped[str] = mapped_column(Text(), nullable=False, server_default=text("'light'"))
    date_format: Mapped[str | None] = mapped_column(Text(), nullable=True)
    default_page_size: Mapped[int] = mapped_column(
        SmallInteger(), nullable=False, server_default=text("25")
    )

    user: Mapped[User] = relationship(back_populates="preferences")

    __table_args__ = (
        CheckConstraint(
            "default_page_size BETWEEN 5 AND 200",
            name="ck_user_preferences_page_size",
        ),
    )
