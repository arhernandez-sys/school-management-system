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

from app.common.enums import AssessmentStatus, AssessmentType
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class AssessmentCategory(Base, TimestampMixin, AuditMixin):
    __tablename__ = "assessment_categories"

    id: Mapped[uuid.UUID] = uuid_pk()
    class_subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_subjects.id", ondelete="CASCADE", name="fk_categories_class_subject"
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
            "uq_categories_class_subject_name", "class_subject_id", "name", unique=True
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
    class_subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_subjects.id", ondelete="RESTRICT", name="fk_assessments_class_subject"
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
    type: Mapped[AssessmentType] = mapped_column(enum_col(AssessmentType), nullable=False)
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
            "class_subject_id",
            "semester_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
