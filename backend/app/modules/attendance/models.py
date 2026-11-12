"""Attendance model (database-schema.md §3.E).

Per-SESSION, per-student record. A session is one scheduled meeting of the offering
(`class_meetings`) on one date, identified by `(attendance_date, session_start)`. Upsert on
(offering_id, student_id, attendance_date, session_start). No-future-date and
"the date must have a scheduled meeting at that time" are service-enforced.

WHY `session_start` AND NOT A `meeting_id` FK: `PUT /offerings/{id}/meetings` hard-deletes
and recreates every meeting row on each schedule save. An FK would either block every
schedule edit (RESTRICT) or silently strip history of its session (SET NULL). The start
time is a stable, self-describing key that survives a schedule edit.

`session_start IS NULL` = a record written before attendance was per-session (Nov 2026).
The service treats such a row as belonging to the FIRST session of its day and stamps the
time the next time that register is saved.
"""

from __future__ import annotations

import uuid
from datetime import date, time

from sqlalchemy import Date, ForeignKey, Index, Time, text
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import AttendanceStatus
from app.db.base import AuditMixin, Base, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class AttendanceRecord(Base, TimestampMixin, AuditMixin):
    __tablename__ = "attendance_records"

    id: Mapped[uuid.UUID] = uuid_pk()
    #: FK -> course_offerings (D31; was class_id -> classes, a HOMEROOM). Attendance is
    #: taken per OFFERING now: a register for "Form 1A" covered seven courses at once,
    #: which is not a thing a lecturer can mark.
    offering_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "course_offerings.id", ondelete="RESTRICT", name="fk_attendance_offering"
        ),
        nullable=False,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_attendance_student"),
        nullable=False,
    )
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_enrollments.id", ondelete="RESTRICT", name="fk_attendance_enrollment"
        ),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_attendance_semester"),
        nullable=False,
    )
    attendance_date: Mapped[date] = mapped_column(Date(), nullable=False)
    #: Start time of the scheduled meeting this mark belongs to. NULL only on legacy
    #: (pre-per-session) rows — see the module docstring.
    session_start: Mapped[time | None] = mapped_column(Time(), nullable=True)
    status: Mapped[AttendanceStatus] = mapped_column(
        enum_col(AttendanceStatus), nullable=False, server_default=text("'present'")
    )

    __table_args__ = (
        Index(
            "uq_attendance_offering_student_session",
            "offering_id",
            "student_id",
            "attendance_date",
            "session_start",
            unique=True,
        ),
        Index("ix_attendance_offering_date", "offering_id", "attendance_date"),
        Index("ix_attendance_student_semester", "student_id", "semester_id"),
    )
