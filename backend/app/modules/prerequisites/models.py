"""Course-prerequisite model (D30 §D4; DDL in `005_tertiary.sql` §5)."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import PrerequisiteType
from app.db.base import AuditMixin, Base, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class CoursePrerequisite(Base, TimestampMixin, AuditMixin):
    """One requirement standing between a student and a course.

    `requirement_type` exists for exactly one case in the source material, and it is
    not an edge case — it is the Internship:

        'course'              → `prerequisite_course_id` names a specific course
        'all_program_courses' → `prerequisite_course_id` IS NULL; the gate is
                                "every course in the programme", which is what
                                `EDUC3201 ← ALL COURSES` actually says

    `program_id` is nullable. NULL means the requirement applies wherever the course
    is taken; set, it applies only within that programme's plan. Both are real: a lab
    gates on its lecture everywhere (`BIOL1204L ← BIOL1102L`), while a programme may
    impose an ordering another programme does not.

    `uq_course_prereq (course_id, prerequisite_course_id, program_id)` allows the same
    pair to be declared once globally and once per programme, which is the only way to
    say "generally X, but in Primary Education also Y".

    ENFORCEMENT IS IN `service.py`, NOT HERE. No CHECK constraint can express
    "successfully completed, judged against the programme's pass mark" — that reads
    grades, snapshots and credit transfers across years.
    """

    __tablename__ = "course_prerequisites"

    id: Mapped[uuid.UUID] = uuid_pk()
    #: The GATED course — the one a student is trying to enrol in.
    course_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("courses.id", ondelete="CASCADE", name="fk_course_prereq_course"),
        nullable=False,
    )
    #: The REQUIRED course. NULL only for `all_program_courses`.
    prerequisite_course_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("courses.id", ondelete="CASCADE", name="fk_course_prereq_prereq"),
        nullable=True,
    )
    #: NULL = applies in every programme.
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="CASCADE", name="fk_course_prereq_program"),
        nullable=True,
    )
    requirement_type: Mapped[PrerequisiteType] = mapped_column(
        enum_col(PrerequisiteType), nullable=False, server_default="course"
    )

    __table_args__ = (
        Index(
            "uq_course_prereq",
            "course_id",
            "prerequisite_course_id",
            "program_id",
            unique=True,
        ),
        Index("ix_course_prereq_course", "course_id"),
        CheckConstraint(
            "(requirement_type = 'course' AND prerequisite_course_id IS NOT NULL) OR "
            "(requirement_type = 'all_program_courses' AND prerequisite_course_id IS NULL)",
            name="ck_course_prereq_shape",
        ),
        CheckConstraint(
            "prerequisite_course_id IS NULL OR prerequisite_course_id <> course_id",
            name="ck_course_prereq_not_self",
        ),
    )
