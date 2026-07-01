"""Grade models (database-schema.md §3.D).

`assessment_grades` (one score per student per assessment, enrollment-provenanced)
and `term_grade_snapshots` (frozen per-subject term grade written at archival).
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
    Numeric,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import GradeStatus
from app.db.base import AuditMixin, Base, TimestampMixin, uuid_pk
from app.db.types import pg_enum


class AssessmentGrade(Base, TimestampMixin, AuditMixin):
    __tablename__ = "assessment_grades"

    id: Mapped[uuid.UUID] = uuid_pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("assessments.id", ondelete="RESTRICT", name="fk_grades_assessment"),
        nullable=False,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_grades_student"),
        nullable=False,
    )
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(
            "class_enrollments.id", ondelete="RESTRICT", name="fk_grades_enrollment"
        ),
        nullable=False,
    )
    status: Mapped[GradeStatus] = mapped_column(
        pg_enum(GradeStatus), nullable=False, server_default=text("'pending'")
    )
    score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    makeup_score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    is_released: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("uq_grades_assessment_student", "assessment_id", "student_id", unique=True),
        Index("ix_grades_student", "student_id"),
        CheckConstraint(
            "(status = 'graded' AND score IS NOT NULL) "
            "OR (status <> 'graded' AND score IS NULL)",
            name="ck_grades_score_when_graded",
        ),
        CheckConstraint("score IS NULL OR score >= 0", name="ck_grades_score_nonneg"),
        CheckConstraint(
            "makeup_score IS NULL OR makeup_score >= 0", name="ck_grades_makeup_nonneg"
        ),
    )


class TermGradeSnapshot(Base, TimestampMixin):
    __tablename__ = "term_grade_snapshots"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_term_snapshot_student"),
        nullable=False,
    )
    class_subject_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(
            "class_subjects.id", ondelete="RESTRICT", name="fk_term_snapshot_class_subject"
        ),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_term_snapshot_semester"),
        nullable=False,
    )
    # Frozen subject identity for transcript stability (D24).
    subject_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("subjects.id", ondelete="RESTRICT", name="fk_term_snapshot_subject"),
        nullable=False,
    )
    numeric_grade: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    letter_grade: Mapped[str] = mapped_column(Text(), nullable=False)
    weight_base_used: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    effective_policy: Mapped[dict] = mapped_column(
        JSONB(), nullable=False, server_default=text("'{}'::jsonb")
    )
    frozen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        Index(
            "uq_term_snapshot",
            "student_id",
            "class_subject_id",
            "semester_id",
            unique=True,
        ),
        Index("ix_term_snapshot_student", "student_id"),
    )
