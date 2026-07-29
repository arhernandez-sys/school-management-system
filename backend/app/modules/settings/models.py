"""Settings / config models (database-schema.md §3.C config bits + §3.D policy +
§3.H system).

Academic structure config (academic_years, semesters), grading config
(grading_scales, grading_scale_bands, assessment_policies), school identity
(school_profile, single-row), and the lightweight audit_log.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import AcademicYearStatus
from app.db.base import AuditMixin, Base, TimestampMixin, uuid_pk
from app.db.types import GUID, JSONType, enum_col


class AcademicYear(Base, TimestampMixin, AuditMixin):
    __tablename__ = "academic_years"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    start_date: Mapped[date] = mapped_column(Date(), nullable=False)
    end_date: Mapped[date] = mapped_column(Date(), nullable=False)
    status: Mapped[AcademicYearStatus] = mapped_column(
        enum_col(AcademicYearStatus), nullable=False, server_default=text("'active'")
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Year-level grading-policy overrides (DB-14); NULL = inherit school default.
    absent_as_zero: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    allow_makeup: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    drop_lowest_count: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)

    __table_args__ = (
        Index("uq_academic_years_name", "name", unique=True),
        Index(
            "uq_academic_years_one_active",
            "status",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        CheckConstraint("end_date > start_date", name="ck_academic_years_dates"),
        CheckConstraint(
            "drop_lowest_count IS NULL OR drop_lowest_count >= 0",
            name="ck_academic_years_drop_nonneg",
        ),
    )


class Semester(Base, TimestampMixin):
    __tablename__ = "semesters"

    id: Mapped[uuid.UUID] = uuid_pk()
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("academic_years.id", ondelete="RESTRICT", name="fk_semesters_year"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    sequence: Mapped[int] = mapped_column(SmallInteger(), nullable=False)
    start_date: Mapped[date] = mapped_column(Date(), nullable=False)
    end_date: Mapped[date] = mapped_column(Date(), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    __table_args__ = (
        Index("uq_semesters_year_seq", "academic_year_id", "sequence", unique=True),
        Index(
            "uq_semesters_one_active",
            "is_active",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        CheckConstraint("sequence IN (1,2)", name="ck_semesters_sequence"),
        CheckConstraint("end_date > start_date", name="ck_semesters_dates"),
    )


class GradingScale(Base, TimestampMixin, AuditMixin):
    __tablename__ = "grading_scales"

    id: Mapped[uuid.UUID] = uuid_pk()
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("academic_years.id", ondelete="RESTRICT", name="fk_grading_scales_year"),
        nullable=False,
    )
    pass_mark: Mapped[float] = mapped_column(
        Numeric(5, 2), nullable=False, server_default=text("60.00")
    )
    is_frozen: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    __table_args__ = (
        Index("uq_grading_scales_year", "academic_year_id", unique=True),
        CheckConstraint("pass_mark BETWEEN 0 AND 100", name="ck_grading_scales_passmark"),
    )


class GradingScaleBand(Base, TimestampMixin):
    __tablename__ = "grading_scale_bands"

    id: Mapped[uuid.UUID] = uuid_pk()
    grading_scale_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("grading_scales.id", ondelete="CASCADE", name="fk_bands_scale"),
        nullable=False,
    )
    letter: Mapped[str] = mapped_column(Text(), nullable=False)
    min_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    max_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    is_passing: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )
    sort_order: Mapped[int] = mapped_column(SmallInteger(), nullable=False)

    __table_args__ = (
        Index("uq_bands_scale_letter", "grading_scale_id", "letter", unique=True),
        CheckConstraint(
            "min_score >= 0 AND max_score <= 100 AND min_score <= max_score",
            name="ck_bands_range",
        ),
    )


class AssessmentPolicy(Base, TimestampMixin, AuditMixin):
    """School-default grading policy — single row pinned to id=1 (DB-14)."""

    __tablename__ = "assessment_policies"

    id: Mapped[int] = mapped_column(
        SmallInteger(), primary_key=True, server_default=text("1")
    )
    absent_as_zero: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    allow_makeup: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )
    drop_lowest_count: Mapped[int] = mapped_column(
        SmallInteger(), nullable=False, server_default=text("0")
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_assessment_policies_singleton"),
        CheckConstraint("drop_lowest_count >= 0", name="ck_assessment_policies_drop_nonneg"),
    )


class SchoolProfile(Base, TimestampMixin, AuditMixin):
    """Single-row school identity/branding (id pinned to 1)."""

    __tablename__ = "school_profile"

    id: Mapped[int] = mapped_column(
        SmallInteger(), primary_key=True, server_default=text("1")
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    logo_storage_key: Mapped[str | None] = mapped_column(Text(), nullable=True)
    address: Mapped[str | None] = mapped_column(Text(), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_school_profile_singleton"),
    )


class AuditLog(Base):
    """Append-only sensitive-action log. bigint identity PK (the §1.2 exception)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(
        BigInteger(), primary_key=True, autoincrement=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_audit_actor"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(Text(), nullable=False)
    entity_type: Mapped[str] = mapped_column(Text(), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSONType(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
