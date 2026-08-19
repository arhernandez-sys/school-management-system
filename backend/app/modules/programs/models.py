"""Programme + curriculum models (D30 §D3; DDL in `005_tertiary.sql` §3–§4)."""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID


class Program(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """One study / major — e.g. `BMAD`, Business Management (plan §A1).

    BAJC offers eight: Business Management, General Studies, Biology, Applied
    Agriculture, Information Technology, Mathematics, Primary Education and Religion,
    across Associate of Social Science / Science / Arts awards.

    `min_passing_grade_point` is the home for the brief's most easily-missed rule:
    **the pass mark is per PROGRAMME.** Primary Education passes at C (2.00); every
    other programme at C+ (2.50). It cannot live on `grading_scales`, whose
    `pass_mark` is one number per ACADEMIC YEAR — a year-level number cannot say two
    different things about two programmes running in it at once. Prerequisite
    validation (§D4, Phase 2C) judges "successfully completed" against this.

    `total_credits` is the figure PRINTED on the programme's sequence (86–102). It is
    stored as declared rather than computed from `program_courses`, so that a
    part-built curriculum does not silently misreport the award's requirement — and so
    that the two can be compared, which is how a data-entry slip in the sequence gets
    noticed.
    """

    __tablename__ = "programs"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(250), nullable=False)
    award: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_credits: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    min_passing_grade_point: Mapped[float] = mapped_column(
        Numeric(3, 2), nullable=False, server_default=text("2.50")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index(
            "uq_programs_code",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_programs_name",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint(
            "min_passing_grade_point BETWEEN 0 AND 4", name="ck_programs_pass_gp"
        ),
    )


class ProgramCourse(Base, TimestampMixin, AuditMixin):
    """One course's position in one programme's plan — THE CURRICULUM.

    ⚠️ `term_label` IS A CURRICULUM POSITION, NOT A CALENDAR TERM. "Semester 1" here
    means "the first semester of this programme's plan"; it is not any particular
    dated row in `semesters`. The two concepts are modelled separately on purpose
    (§D3):

        WHEN a course is actually taught  →  `semesters`
        WHERE it sits in the plan         →  this table

    Term blocks are neither uniform across programmes nor limited to two:

        7 programmes      Summer 1 · Semester 1 · Semester 2 · Semester 3 · Semester 4
        Primary Education Summer 1 · Sem 1 · Sem 2 · **Spring 1** · Sem 3 · Sem 4 ·
                          **Spring 2** · **Semester 5**

    so `term_label` is free text ordered by `term_order`, not an enum. An enum would
    force a migration the first time BAJC adds a block.

    `uq_program_courses (program_id, course_id)` means a course appears at most ONCE
    in a programme — a repeated course is a retake, which is enrolment history, not
    curriculum (and is out of scope; see plan §G item 5).
    """

    __tablename__ = "program_courses"

    id: Mapped[uuid.UUID] = uuid_pk()
    program_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="CASCADE", name="fk_program_courses_program"),
        nullable=False,
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("courses.id", ondelete="RESTRICT", name="fk_program_courses_course"),
        nullable=False,
    )
    term_label: Mapped[str] = mapped_column(String(50), nullable=False)
    term_order: Mapped[int] = mapped_column(SmallInteger(), nullable=False)
    #: False for an elective the plan lists as a choice rather than a requirement.
    #: Credits still count toward the programme; completion does not.
    is_required: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index("uq_program_courses", "program_id", "course_id", unique=True),
        Index("ix_program_courses_program_order", "program_id", "term_order"),
        CheckConstraint("term_order > 0", name="ck_program_courses_term_order"),
    )
