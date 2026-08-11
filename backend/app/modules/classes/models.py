"""Academic-structure / hub models (database-schema.md §3.C, **D29 subject-class
model** — supersedes the D23 homeroom model).

`subjects` (catalog), `classes` (a SUBJECT CLASS, e.g. "Math-1"), `class_subjects`
(the gradebook/ownership unit — exactly ONE per class under D29), `class_teachers`
(teacher ownership relation), `class_enrollments` (per-subject-class roster — a
student holds MANY active rows, one per subject class they take), `class_meetings`
(the weekly day/time/room that builds each timetable).

D29 (sixth form, 2026-08-06) reframed `classes` from "homeroom section that teaches
many subjects" to "one subject class taught by one teacher at a set time" — the
university/CAPE model. No table was rebuilt: `class_enrollments` was already a plain
join table whose `uq_enroll_active` index permits one row per (class, student,
semester), so the old "exactly one section per student" rule lived in service code
(a silent transfer-on-enroll), not in the schema.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID


class Subject(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "subjects"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    code: Mapped[str | None] = mapped_column(Text(), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index(
            "uq_subjects_name",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_subjects_code",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND code IS NOT NULL"),
        ),
    )


class Class(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """A SUBJECT CLASS — e.g. "Math-1" (D29).

    Holds exactly one `ClassSubject` (the invariant is enforced in the service, not
    the DB, so pre-D29 multi-subject rows still load). `grade_level` survives as the
    year group the class is FOR ("Lower 6"), which is a filter rather than a roster:
    a student's own level now lives on `StudentProfile.year_group`.
    """

    __tablename__ = "classes"

    id: Mapped[uuid.UUID] = uuid_pk()
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("academic_years.id", ondelete="RESTRICT", name="fk_classes_year"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    grade_level: Mapped[str] = mapped_column(Text(), nullable=False)
    section: Mapped[str | None] = mapped_column(Text(), nullable=True)
    capacity: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    # Free-text display label surfaced by the Attendance class picker. Named for the
    # homeroom it labelled pre-D29; kept under the old name because the column has
    # existed in MariaDB since 001_missing_fields.sql and renaming it buys nothing.
    homeroom_label: Mapped[str | None] = mapped_column(Text(), nullable=True)
    is_archived: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    __table_args__ = (
        Index(
            "uq_classes_year_name",
            "academic_year_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint(
            "capacity IS NULL OR capacity > 0", name="ck_classes_capacity"
        ),
    )


class ClassSubject(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """Class↔Subject join — the gradebook/ownership unit.

    Under D29 there is exactly ONE live row per class (the subject that class
    teaches). It survives as its own table rather than collapsing into a
    `classes.subject_id` column because every assessment, grade, and teacher
    assignment in the system keys off `class_subject_id`.
    """

    __tablename__ = "class_subjects"

    id: Mapped[uuid.UUID] = uuid_pk()
    class_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("classes.id", ondelete="RESTRICT", name="fk_class_subjects_class"),
        nullable=False,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("subjects.id", ondelete="RESTRICT", name="fk_class_subjects_subject"),
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index(
            "uq_class_subjects_class_subject",
            "class_id",
            "subject_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_class_subjects_class",
            "class_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_class_subjects_subject",
            "subject_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class ClassTeacher(Base, TimestampMixin, AuditMixin):
    """Teacher↔subject-class ownership relation. Source of truth for
    assert_teacher_owns_class_subject / assert_teacher_owns_section, and the join
    that builds a teacher's own timetable."""

    __tablename__ = "class_teachers"

    id: Mapped[uuid.UUID] = uuid_pk()
    class_subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_subjects.id", ondelete="CASCADE", name="fk_class_teachers_class_subject"
        ),
        nullable=False,
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "teacher_profiles.id", ondelete="RESTRICT", name="fk_class_teachers_teacher"
        ),
        nullable=False,
    )
    is_lead: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        Index(
            "uq_class_teachers_class_subject_teacher",
            "class_subject_id",
            "teacher_id",
            unique=True,
        ),
        Index("ix_class_teachers_teacher", "teacher_id"),
    )


class ClassEnrollment(Base, TimestampMixin, AuditMixin):
    """Student↔subject-class roster membership, semester-scoped.

    D29: a student holds **many** active rows for a semester — one per subject class
    they take. `uq_enroll_active` is keyed on (class_id, student_id, semester_id), so
    it already permitted this; what changed is that `enroll_students` no longer closes
    the student's other rows (that transfer-on-enroll was the entire "one homeroom"
    rule, and it would have silently dropped Math when a student was added to Biology).
    """

    __tablename__ = "class_enrollments"

    id: Mapped[uuid.UUID] = uuid_pk()
    class_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("classes.id", ondelete="RESTRICT", name="fk_enroll_class"),
        nullable=False,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_enroll_student"),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_enroll_semester"),
        nullable=False,
    )
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    unenrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "uq_enroll_active",
            "class_id",
            "student_id",
            "semester_id",
            unique=True,
            postgresql_where=text("unenrolled_at IS NULL"),
        ),
        Index(
            "ix_enroll_class_semester",
            "class_id",
            "semester_id",
            postgresql_where=text("unenrolled_at IS NULL"),
        ),
        Index("ix_enroll_student", "student_id"),
    )


class ClassMeeting(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """One recurring weekly meeting of a subject class — "Mon 08:00–09:30, Room A".

    Anchored on `class_subject_id`, not `class_id`. Teachers own `class_subjects`
    (see `ClassTeacher`), so a teacher's timetable is one join off this table; the
    same anchor keeps the rows meaningful for any pre-D29 multi-subject class, where
    "when does this class meet" is only answerable per subject.

    Times are free-form rather than slots in a fixed period grid (stakeholder
    decision, 2026-08-06) — no bell-schedule setup is required before a class can be
    scheduled. Overlaps are NOT rejected here: teacher/room/student clashes are
    reported as warnings by the service, following the warn-only precedent set for
    over-capacity enrollment (D-Q6).
    """

    __tablename__ = "class_meetings"

    id: Mapped[uuid.UUID] = uuid_pk()
    class_subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_subjects.id", ondelete="CASCADE", name="fk_class_meetings_class_subject"
        ),
        nullable=False,
    )
    #: ISO weekday, 1=Mon … 5=Fri (`app.common.enums.DayOfWeek`). Stored as an int so
    #: `ORDER BY day_of_week, start_time` renders the grid in weekday order.
    day_of_week: Mapped[int] = mapped_column(SmallInteger(), nullable=False)
    start_time: Mapped[time] = mapped_column(Time(), nullable=False)
    end_time: Mapped[time] = mapped_column(Time(), nullable=False)
    room: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "day_of_week BETWEEN 1 AND 5", name="ck_class_meetings_day_of_week"
        ),
        CheckConstraint("end_time > start_time", name="ck_class_meetings_time_order"),
        Index(
            "ix_class_meetings_class_subject",
            "class_subject_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_class_meetings_day_start", "day_of_week", "start_time"),
    )
