"""Assessment models (database-schema.md §3.D).

`assessment_categories` (optional weighted grouping per class_subject) and
`assessments` (teacher-owned graded activities per class_subject + semester).
Grade rows live in grades/.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import AssessmentStatus, GradeRevisionStatus
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class AssessmentCategory(Base, TimestampMixin, AuditMixin):
    __tablename__ = "assessment_categories"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "course_offerings.id", ondelete="CASCADE", name="fk_categories_offering"
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    weight: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    # Category-level policy overrides (DB-14); NULL = inherit.
    absent_as_zero: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    allow_makeup: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    drop_lowest_count: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)

    __table_args__ = (
        Index(
            "uq_categories_class_subject_name", "offering_id", "name", unique=True
        ),
        CheckConstraint("weight >= 0", name="ck_categories_weight"),
        CheckConstraint(
            "drop_lowest_count IS NULL OR drop_lowest_count >= 0",
            name="ck_categories_drop_nonneg",
        ),
    )


class Assessment(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "assessments"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "course_offerings.id", ondelete="RESTRICT", name="fk_assessments_offering"
        ),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_assessments_semester"),
        nullable=False,
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "assessment_categories.id", ondelete="SET NULL", name="fk_assessments_category"
        ),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(Text(), nullable=False)
    max_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    weight: Mapped[float] = mapped_column(
        Numeric(5, 2), nullable=False, server_default=text("1.00")
    )
    assessment_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status: Mapped[AssessmentStatus] = mapped_column(
        enum_col(AssessmentStatus), nullable=False, server_default=text("'draft'")
    )
    is_released: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # D47: set when the Dean approves a reopen request; extends the marking window
    # (assessments/marking.py). NULL = never reopened.
    reopened_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Per-assessment policy overrides (DB-14, highest precedence); NULL = inherit.
    absent_as_zero: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    allow_makeup: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    drop_lowest_count: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)

    __table_args__ = (
        CheckConstraint("max_score > 0", name="ck_assessments_maxscore"),
        CheckConstraint("weight >= 0", name="ck_assessments_weight"),
        CheckConstraint(
            "drop_lowest_count IS NULL OR drop_lowest_count >= 0",
            name="ck_assessments_drop_nonneg",
        ),
        Index(
            "ix_assessments_class_subject_semester",
            "offering_id",
            "semester_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class AssessmentReopenRequest(Base, TimestampMixin):
    """A Lecturer asks the Dean to reopen a closed marking window (D47).

    Modelled on `grade_revision_requests` (D30 §D7) and for the same reasons: the Lecturer
    asks, the Dean decides, the ruling is the record. Approval sets
    `assessments.reopened_until`, which `assessments/marking.py` reads as an extension of
    the window — nothing else about grading changes.

    **At most ONE open request per assessment**: `pending_flag` is a STORED generated
    column, `IF(status = 'pending', 1, NULL)`, under the unique `uq_assessment_reopen_open
    (assessment_id, pending_flag)`. It is deliberately NOT mapped — an ORM that thought it
    could set a generated column gets MariaDB 3105 on every insert.
    """

    __tablename__ = "assessment_reopen_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("assessments.id", ondelete="CASCADE", name="fk_assessment_reopen_assessment"),
        nullable=False,
    )
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_assessment_reopen_requested_by"),
        nullable=False,
    )
    #: Required — "I forgot" is a reason; an empty request gives the Dean nothing to weigh.
    reason: Mapped[str] = mapped_column(Text(), nullable=False)
    status: Mapped[GradeRevisionStatus] = mapped_column(
        enum_col(GradeRevisionStatus), nullable=False, server_default=text("'pending'")
    )
    #: Days the Dean granted on approval; NULL while pending or when denied.
    granted_days: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_assessment_reopen_decided_by"),
        nullable=True,
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status = 'pending' OR decided_at IS NOT NULL",
            name="ck_assessment_reopen_decided",
        ),
        CheckConstraint(
            "granted_days IS NULL OR granted_days BETWEEN 1 AND 14",
            name="ck_assessment_reopen_days",
        ),
        Index("ix_assessment_reopen_status", "status"),
        Index("ix_assessment_reopen_requested_by", "requested_by_user_id"),
    )
