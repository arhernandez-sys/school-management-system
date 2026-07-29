"""Attendance model (database-schema.md §3.E).

Per-day, per-SECTION (homeroom), per-student record. Upsert on
(class_id, student_id, attendance_date). No-future-date is service-enforced.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import AttendanceStatus
from app.db.base import AuditMixin, Base, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class AttendanceRecord(Base, TimestampMixin, AuditMixin):
    __tablename__ = "attendance_records"

    id: Mapped[uuid.UUID] = uuid_pk()
    class_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("classes.id", ondelete="RESTRICT", name="fk_attendance_class"),
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
    status: Mapped[AttendanceStatus] = mapped_column(
        enum_col(AttendanceStatus), nullable=False, server_default=text("'present'")
    )

    __table_args__ = (
        Index(
            "uq_attendance_class_student_date",
            "class_id",
            "student_id",
            "attendance_date",
            unique=True,
        ),
        Index("ix_attendance_class_date", "class_id", "attendance_date"),
        Index("ix_attendance_student_semester", "student_id", "semester_id"),
    )
