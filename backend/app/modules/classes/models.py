"""Academic-structure / hub models (database-schema.md §3.C, D23 section model).

`subjects` (catalog), `classes` (the SECTION/homeroom), `class_subjects` (the
section↔subject gradebook/ownership unit), `class_teachers` (teacher ownership
relation, rescoped to class_subject by D23), `class_enrollments` (per-section
roster).
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
    """The SECTION / homeroom (subject-agnostic, D23)."""

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
    # Display label for the homeroom, surfaced by the Attendance section picker.
    # The column has existed in MariaDB since 001_missing_fields.sql; only the ORM
    # mapping was missing.
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
    """Section↔Subject join — the gradebook/ownership unit (D23)."""

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
    """Teacher↔(section,subject) ownership relation (D23). Source of truth for
    assert_teacher_owns_class_subject / assert_teacher_owns_section."""

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
    """Student↔Section roster membership (per-section, semester-scoped, D23)."""

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
