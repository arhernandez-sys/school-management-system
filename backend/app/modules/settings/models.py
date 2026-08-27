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
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import AcademicYearStatus, TermType
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
    """One CALENDAR term. N per academic year since D30 (§D3).

    `CHECK (sequence IN (1,2))` and the hard-coded two-term creation in
    `POST /settings/academic-years` together made it impossible to record more than two
    terms in a year, which BAJC needs: its programmes run Summer and Spring blocks
    alongside the numbered semesters. `005_tertiary.sql` §6 dropped the CHECK and added
    `term_type`; the per-year uniqueness on `sequence` is KEPT, and so is
    `uq_semesters_one_active` — exactly one term is active school-wide at a time, and
    having more terms does not change that.

    Not to be confused with `program_courses.term_label`, which is a position in a
    programme's PLAN rather than a dated term (§D3).
    """

    __tablename__ = "semesters"

    id: Mapped[uuid.UUID] = uuid_pk()
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("academic_years.id", ondelete="RESTRICT", name="fk_semesters_year"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    term_type: Mapped[TermType] = mapped_column(
        enum_col(TermType), nullable=False, server_default=text("'semester'")
    )
    sequence: Mapped[int] = mapped_column(SmallInteger(), nullable=False)
    start_date: Mapped[date] = mapped_column(Date(), nullable=False)
    end_date: Mapped[date] = mapped_column(Date(), nullable=False)
    #: Brief §18 / D30 §D6 — the Lecturer grade-entry cutoff, i.e. the **END-TERM**
    #: deadline (D32-1; the column keeps its name, see `docs/midterm-revision-reports-plan.md`
    #: §E for why it was not renamed). Set by the Dean-only `POST`/`PATCH
    #: /settings/semesters`; enforced by `_assert_grade_window_open` in
    #: `grades/service.upsert_grades`, the single grade write path, as a 409
    #: `grade_window_closed`. **NULL = no deadline, window open** — the default, and
    #: deliberately so: a guessed cutoff would lock lecturers out of a live term.
    #: Stored UTC (see `settings/service._to_utc`).
    grade_submission_deadline: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: D32 — the **MID-TERM** grading window, independent of the end-term deadline
    #: above. Together they answer a question the single cutoff could not: *which
    #: grading period does an assessment belong to*. That is what
    #: `grades/revisions.midterm_revision_eligible` needs, and what decides when a
    #: mid-term report card can be frozen (`reports/freeze.freeze_midterm`).
    #:
    #: **Both NULL is the default and means "this term has no mid-term period"** — the
    #: state of every semester that existed before D32, and the reason `009` needs no
    #: data migration. The two are set and cleared together; the service rejects one
    #: without the other, because a start with no end can never elapse and an end with
    #: no start has nothing to measure "existed before" against.
    #:
    #: Stored UTC, same as the deadline (see `settings/service._to_utc`).
    midterm_submission_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    midterm_submission_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
        # `ck_semesters_sequence` (sequence IN (1,2)) was dropped by 005 §6 — see the
        # class docstring. `sequence` is still 1-based and unique within the year; the
        # service enforces the lower bound.
        CheckConstraint("end_date > start_date", name="ck_semesters_dates"),
        # Both NULL, or both set with end after start. The service raises a readable
        # 422 first (`create_semester` / `update_semester`); this is the backstop that
        # stops a direct SQL edit leaving a half-configured window behind, which the
        # revision rules would then read as "no mid-term period" and silently disable.
        CheckConstraint(
            "(midterm_submission_start IS NULL AND midterm_submission_end IS NULL)"
            " OR (midterm_submission_start IS NOT NULL"
            " AND midterm_submission_end IS NOT NULL"
            " AND midterm_submission_end > midterm_submission_start)",
            name="ck_semesters_midterm_window",
        ),
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
    #: The band's value on the 4.00 scale (D30 §D5; column added by `005` §7).
    #: NULL on every scale in the database today — seeding the BAJC 8-band scale is
    #: Phase 3. `calc.meets_grade_point` falls back to `is_passing` while it is
    #: absent, so prerequisite checks work before the seed and tighten after it.
    grade_point: Mapped[float | None] = mapped_column(Numeric(3, 2), nullable=True)
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
    #: D32 (brief §4) — may STUDENTS see their own grades at all?
    #:
    #: **Default false**, which is the client's decision rather than a conservative guess:
    #: students lose grade visibility unless the Dean turns it back on. Enforced server-side
    #: by `core.deps.require_student_grade_visibility` (403 `grades_hidden`) on every
    #: student-facing grade surface, and echoed on `CurrentUser` so the SPA can hide the nav
    #: without handing students the settings endpoint.
    #:
    #: It lands on this singleton rather than in a new table because this is already the one
    #: row the Dean edits at `/settings/assessment-policy`; a second singleton would need its
    #: own endpoint, screen and `id = 1` CHECK for one boolean.
    #:
    #: **The Registrar's removal is NOT this flag.** That is unconditional and lives in the
    #: role tuples on `grades/router.py` — a toggle would imply it is reversible, and the
    #: client asked for it to be permanent.
    students_can_view_grades: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
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


class Religion(Base):
    """The Religion vocabulary (D39, Meeting #2 item 8). READ-ONLY to this application.

    Created by `013_meeting2_schema.sql` from the client's own dump, and kept in THEIR
    spelling: an int PK, and `createdon`/`createdby`/`editedby`/`editedon` where the rest
    of this schema uses uuid PKs and `created_at`/`created_by` with a FK onto `users`.
    Nothing here inherits the mixins, because the mixins describe the house convention
    this table deliberately does not follow.

    Keeping their spelling is affordable precisely BECAUSE it is read-only: the client
    owns the contents and maintains them with their own tooling, and this application
    only lists the rows into a dropdown. There is no create/update/delete path, no audit
    row, and no router verb but GET. If religions ever need to be edited from here, that
    is the moment to bring the table onto house convention -- not before.

    Note what this is NOT: a foreign key. `student_profiles.religion` stays free-text
    `varchar(100)`, because rows imported from the client's previous system hold values
    this list does not carry and a FK would reject them outright. D37 settled that shape
    for gender and school year -- constrain the WRITE PATH, not the column.
    """

    __tablename__ = "religions"

    id: Mapped[int] = mapped_column(Integer(), primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code_name: Mapped[str | None] = mapped_column(String(10), nullable=True)
    #: The client's audit columns, mapped so the model DESCRIBES the table rather than a
    #: convenient subset of it. `createdon` and `createdby` are NOT NULL with no server
    #: default, so a model that omitted them could not insert a row at all -- which reads
    #: as "read-only" right up until someone needs a fixture and discovers it is really
    #: "silently broken". Read-only is enforced by there being no write service and no
    #: router verb but GET, not by leaving the mapping incomplete.
    #:
    #: `createdby` / `editedby` are varchar usernames in the client's system, NOT uuid
    #: foreign keys onto `users` -- do not "fix" them into FKs without their agreement.
    createdon: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    createdby: Mapped[str] = mapped_column(String(50), nullable=False)
    editedby: Mapped[str | None] = mapped_column(String(50), nullable=True)
    editedon: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


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
