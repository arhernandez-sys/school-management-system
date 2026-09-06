"""Classroom model (D44; DDL in `017_sims10_reconcile.sql` §8)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import ClassroomStatus
from app.db.base import Base
from app.db.types import GUID, enum_col


class Classroom(Base):
    """One physical room.

    ⚠️ THE COLUMN NAMES ARE THE CLIENT'S, INCLUDING THE CAPITALS. `classroomid`,
    `Building`, `Capacity` and `roomcode` are carried over from `sims_10.sql` verbatim.
    Renaming them to house style (`id`, `building`, …) would make the client's own dump and
    this database disagree about a table they authored, and they reload from that dump.
    Every other table here predates them and keeps house style; this one does not, and the
    inconsistency is the honest signal about where it came from.

    ⚠️ IT ALSO DOES NOT USE THE STANDARD MIXINS. `TimestampMixin`/`AuditMixin` would give
    it `created_at`/`updated_at`/`created_by`/`updated_by`; the client's table already has
    the same four facts under `created_on`/`edited_on`/`created_by`/`edited_by`. Two sets
    of audit columns on one row is worse than one set with unusual names.

    NOT SOFT-DELETED, and that is a deliberate difference from `programs` and `courses`. A
    room that closes is set `Inactive`, which is what the client's own enum is for. Rooms
    are referenced by `course_offerings.classroomid` with `ON DELETE SET NULL`, so a hard
    delete degrades an offering to "no room" rather than orphaning it — acceptable for a
    row with no history worth keeping.
    """

    __tablename__ = "classroom"

    classroomid: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, server_default=text("uuid_v4()")
    )
    #: e.g. `A-101`. Unique — a building can be renamed but two rooms cannot share a code,
    #: and the code is what a lecturer reads off a timetable.
    roomcode: Mapped[str] = mapped_column(String(25), nullable=False)
    building: Mapped[str] = mapped_column("Building", String(60), nullable=False)
    #: Seats. `0` means "not recorded", not "a room with no chairs" — the client's dump
    #: defaults it to 0 and most of their rows are still at it.
    capacity: Mapped[int] = mapped_column(
        "Capacity", Integer(), nullable=False, server_default=text("0")
    )
    #: Lecture / Lab / Computer lab / … Free text, not an enum: the client did not give a
    #: closed list and inventing one would reject whatever they type next.
    room_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    #: See `ClassroomStatus` — the API only ever WRITES `Active`/`Inactive`. The other
    #: three describe live occupancy, which the timetable derives.
    status: Mapped[ClassroomStatus] = mapped_column(
        enum_col(ClassroomStatus), nullable=False, server_default=text("'Active'")
    )

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_classroom_created_by"),
        nullable=True,
    )
    created_on: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    edited_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_classroom_edited_by"),
        nullable=True,
    )
    #: NULL until edited — the 015 convention, which the client's table happens to match.
    edited_on: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("uq_classroom_roomcode", "roomcode", unique=True),
        CheckConstraint("`Capacity` >= 0", name="ck_classroom_capacity"),
    )

    @property
    def label(self) -> str:
        """`A-101 · Main Block` — what a picker shows."""
        return f"{self.roomcode} · {self.building}"
