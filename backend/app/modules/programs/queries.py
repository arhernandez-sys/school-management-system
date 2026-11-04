"""Reusable programme-level queries (D31).

`classes.grade_level` used to answer "how is the school distributed?" with a column read —
`Form 1`..`Form 4`, straight off the homeroom. `008` dropped it, and a junior college has
no Form axis to replace it with; the tertiary equivalent is the PROGRAMME a student is
enrolled on.

That breakdown is now needed in two places — the principal dashboard tile and
`GET /reports/enrollment` — which is exactly the shape that produced nine independent
spellings of "order students by name" before `STUDENT_NAME_ORDER` consolidated them. So
the query lives here once and each caller shapes its own wire model from the rows. Two
screens reporting different enrolment totals is a bug users notice and nobody can explain.
"""

from __future__ import annotations

import uuid
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.programs.models import Program
from app.modules.offerings.models import ClassEnrollment
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile

#: What an unassigned student's programme is called on every screen. Defined here so the
#: dashboard and the report cannot label the same row differently.
UNASSIGNED_PROGRAMME = "Not assigned"


class ProgrammeCount(NamedTuple):
    """One programme and how many students it holds. `programme_id` is None for the
    unassigned row."""

    programme_id: uuid.UUID | None
    code: str | None
    name: str
    count: int


def enrollment_by_programme(db: Session, year: AcademicYear) -> list[ProgrammeCount]:
    """Students per programme for one academic year, busiest first.

    Counted from `student_profiles.program_id`, NOT from what the student is sitting this
    term. A student on Business Management who happens to be enrolled in no offerings this
    semester is still a Business Management student, and a breakdown that lost them would
    disagree with the roll on the Students screen.

    The year still bounds it, through enrolment history: only students with at least one
    live enrolment in one of the year's terms are counted, so an archived year reports the
    cohort it actually had rather than today's roll.

    Students with no programme come back as one `UNASSIGNED_PROGRAMME` row rather than
    being dropped. Until the Phase 5 seed lands that row is the whole college, and an
    empty result would read as "no students".
    """
    year_semesters = select(Semester.id).where(Semester.academic_year_id == year.id)
    enrolled_this_year = (
        select(ClassEnrollment.student_id)
        .where(
            ClassEnrollment.semester_id.in_(year_semesters),
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .distinct()
    )

    rows = db.execute(
        select(
            Program.id,
            Program.code,
            Program.name,
            func.count(func.distinct(StudentProfile.id)),
        )
        .select_from(StudentProfile)
        .outerjoin(Program, Program.id == StudentProfile.program_id)
        .where(
            StudentProfile.deleted_at.is_(None),
            StudentProfile.id.in_(enrolled_this_year),
        )
        .group_by(Program.id, Program.code, Program.name)
        .order_by(
            func.count(func.distinct(StudentProfile.id)).desc(), Program.code.asc()
        )
    ).all()

    return [
        ProgrammeCount(
            programme_id=pid,
            code=code,
            name=name or UNASSIGNED_PROGRAMME,
            count=n,
        )
        for (pid, code, name, n) in rows
    ]
