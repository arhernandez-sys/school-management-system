"""Calendar event model (Module 12 — scope addition, 2026-07).

Backs the school-wide calendar (`frontend/src/features/calendar/`). The `events`
table was created by `db/mariadb/001_missing_fields.sql` to satisfy the finished
frontend and had no ORM mapping until now; this module closes that gap.

**This model intentionally departs from the house style**, because it is mapped to
a table that already exists and must not be re-shaped:

* No `SoftDeleteMixin` — the table has no `deleted_at`, so DELETE is a hard delete.
  A calendar entry carries no academic history, so nothing needs it to survive.
* No `AuditMixin` — the table has no `created_by`/`updated_by`. Authorship lives in
  the domain column `created_by_user_id`, which is `NOT NULL`.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, time

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, Text, Time, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class EventCategory(str, enum.Enum):
    HOLIDAY = "holiday"
    EXAM = "exam"
    MEETING = "meeting"
    ACTIVITY = "activity"
    OTHER = "other"


class EventVisibility(str, enum.Enum):
    """`global` reaches every role; `internal` is staff-only (hidden from students)."""

    GLOBAL = "global"
    INTERNAL = "internal"


class Event(Base, TimestampMixin):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    category: Mapped[EventCategory] = mapped_column(
        enum_col(EventCategory), nullable=False, server_default=text("'other'")
    )
    visibility: Mapped[EventVisibility] = mapped_column(
        enum_col(EventVisibility), nullable=False, server_default=text("'global'")
    )
    #: Inclusive range. `end_date IS NULL` means a single-day event.
    start_date: Mapped[date] = mapped_column(Date(), nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    all_day: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )
    start_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time(), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_events_created_by"),
        nullable=False,
    )

    __table_args__ = (Index("ix_events_start_date", "start_date"),)
