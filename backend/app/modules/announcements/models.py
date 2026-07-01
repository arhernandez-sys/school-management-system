"""Announcement models (database-schema.md §3.F).

`announcements` (school-wide or class-scoped broadcasts) and `announcement_reads`
(per-user read ledger for the unread bell).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import AnnouncementAudience
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import pg_enum


class Announcement(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = uuid_pk()
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_announcements_author"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(Text(), nullable=False)
    body: Mapped[str] = mapped_column(Text(), nullable=False)
    audience: Mapped[AnnouncementAudience] = mapped_column(
        pg_enum(AnnouncementAudience), nullable=False
    )
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("classes.id", ondelete="CASCADE", name="fk_announcements_class"),
        nullable=True,
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(audience = 'class') = (class_id IS NOT NULL)",
            name="ck_announcements_class_audience",
        ),
        Index(
            "ix_announcements_published",
            text("published_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_announcements_class",
            "class_id",
            postgresql_where=text("class_id IS NOT NULL"),
        ),
        Index("ix_announcements_audience", "audience"),
    )


class AnnouncementRead(Base):
    __tablename__ = "announcement_reads"

    announcement_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("announcements.id", ondelete="CASCADE", name="fk_announcement_reads_ann"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_announcement_reads_user"),
        primary_key=True,
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        Index("ix_announcement_reads_user", "user_id"),
    )
