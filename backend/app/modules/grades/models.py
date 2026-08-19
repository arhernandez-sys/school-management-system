"""Grade models (database-schema.md §3.D).

`assessment_grades` (one score per student per assessment, enrollment-provenanced),
`term_grade_snapshots` (frozen per-subject term grade written at archival) and
`grade_revision_requests` (the second-opportunity approval workflow, D30 §D7).
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
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import GradeRevisionStatus, GradeStatus
from app.db.base import AuditMixin, Base, TimestampMixin, uuid_pk
from app.db.types import GUID, JSONType, enum_col


class AssessmentGrade(Base, TimestampMixin, AuditMixin):
    __tablename__ = "assessment_grades"

    id: Mapped[uuid.UUID] = uuid_pk()
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("assessments.id", ondelete="RESTRICT", name="fk_grades_assessment"),
        nullable=False,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_grades_student"),
        nullable=False,
    )
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_enrollments.id", ondelete="RESTRICT", name="fk_grades_enrollment"
        ),
        nullable=False,
    )
    status: Mapped[GradeStatus] = mapped_column(
        enum_col(GradeStatus), nullable=False, server_default=text("'pending'")
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
        GUID(),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_term_snapshot_student"),
        nullable=False,
    )
    class_subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "class_subjects.id", ondelete="RESTRICT", name="fk_term_snapshot_class_subject"
        ),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_term_snapshot_semester"),
        nullable=False,
    )
    # Frozen COURSE identity for transcript stability (D24). FK -> `courses` since
    # `006_courses_cutover.sql`; the column keeps the name `subject_id` (D30 §D2 —
    # display labels renamed, technical identifiers preserved). The rows already held
    # valid `courses.id` values before the swap, because `005` copied every `subjects`
    # row into `courses` PRESERVING ITS UUID.
    subject_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("courses.id", ondelete="RESTRICT", name="fk_term_snapshot_course"),
        nullable=False,
    )
    numeric_grade: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    letter_grade: Mapped[str] = mapped_column(Text(), nullable=False)
    weight_base_used: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    # ── Frozen GPA inputs (D30 §D5; columns added by `005_tertiary.sql` §7) ────────
    # Frozen for the same reason as `effective_policy`: a GPA is only reproducible if
    # the grade point AND the credit weight it was computed from are captured. Editing
    # a course from 3 credits to 4, or re-pointing a band's grade point, must not move
    # a report card that has already been issued.
    #
    # All three are nullable, and every row written before Phase 3 has them NULL. They
    # are also nullable going forward for one real case: a scale with no `grade_point`
    # (an archived year's frozen 5-band scale) cannot answer for a letter, and a
    # guessed 0.00 would read as an F the student never earned.
    grade_point: Mapped[float | None] = mapped_column(Numeric(3, 2), nullable=True)
    credits: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    quality_points: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    effective_policy: Mapped[dict] = mapped_column(
        JSONType(), nullable=False, default=dict
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


class GradeRevisionRequest(Base, TimestampMixin):
    """A Lecturer's request to revise one grade, and the Dean's ruling on it (D30 §D7).

    **The database already carried the second-attempt SCORE** before D30 —
    `assessment_grades.makeup_score` plus the `allow_makeup` policy chain. What it had no
    room for was the *request*: who asked, why, what they proposed, who decided and when
    (plan §B2). This table is that missing half, and nothing else about grading changed to
    accommodate it.

    **THE ORIGINAL SCORE IS NEVER OVERWRITTEN**, which is the rule the whole design turns
    on. On approval the revised mark is written to `assessment_grades.makeup_score` and
    `score` is left holding what the student first earned; `original_score` here and an
    `audit_log` row carry the same pair. Three places record it, and a reader can reconcile
    any two of them.

    **At most ONE open request per grade.** `pending_flag` is a STORED generated column,
    `IF(status = 'pending', 1, NULL)`, under the unique `uq_grade_revision_open
    (assessment_grade_id, pending_flag)`. NULLs do not collide in a unique index, so any
    number of DECIDED rows coexist while a second pending one is refused outright — the
    same shape as `student_program_history.open_flag`. It is deliberately NOT mapped as a
    writable attribute: an ORM that thought it could set a generated column produces a
    MariaDB 3105 on every insert.

    `ck_grade_revision_decided` guarantees a decided row carries a `decided_at`, so a
    ruling can never exist without a timestamp.
    """

    __tablename__ = "grade_revision_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    #: The exact (assessment, student) result under review. A revision is about ONE grade,
    #: not a whole gradebook, which is why the request hangs off `assessment_grades` rather
    #: than off the offering.
    assessment_grade_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "assessment_grades.id", ondelete="CASCADE", name="fk_grade_revision_grade"
        ),
        nullable=False,
    )
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_grade_revision_requested_by"),
        nullable=False,
    )
    #: NOT NULL — brief §20 asks the Lecturer for a description, and a revision with no
    #: stated reason gives the Dean nothing to rule on.
    reason: Mapped[str] = mapped_column(Text(), nullable=False)
    #: What the student had when the request was filed. Snapshotted rather than read back
    #: through the FK, because the point is to record the value at THAT moment.
    original_score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    proposed_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    status: Mapped[GradeRevisionStatus] = mapped_column(
        enum_col(GradeRevisionStatus), nullable=False, server_default=text("'pending'")
    )
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_grade_revision_decided_by"),
        nullable=True,
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decision_note: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "proposed_score >= 0 AND (original_score IS NULL OR original_score >= 0)",
            name="ck_grade_revision_scores_nonneg",
        ),
        CheckConstraint(
            "status = 'pending' OR decided_at IS NOT NULL",
            name="ck_grade_revision_decided",
        ),
        Index("ix_grade_revision_status", "status"),
        Index("ix_grade_revision_requested_by", "requested_by_user_id"),
    )
