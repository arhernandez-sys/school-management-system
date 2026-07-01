"""Declarative base + shared mixins (database-schema.md §1.3–1.4).

All business tables use a UUID PK (DB-1). Mixins map to the standard columns:
 - TimestampMixin: created_at / updated_at (timestamptz, server-default now()).
 - AuditMixin:     created_by / updated_by (uuid FK -> users, SET NULL).
 - SoftDeleteMixin: deleted_at (timestamptz NULL).

`updated_at` is kept current by SQLAlchemy `onupdate` AND a DB trigger backstop
(set_updated_at(), created in the initial migration, schema §7).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Single declarative base; its metadata drives Alembic autogenerate."""


def uuid_pk() -> Mapped[uuid.UUID]:
    """A UUID primary key column with a DB-side gen_random_uuid() default (pgcrypto)."""
    return mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class AuditMixin:
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
