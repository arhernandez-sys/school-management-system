"""Reusable query fragments for offerings (D31).

An offering is scoped to a SEMESTER and reaches its academic year through it — `classes`
used to store `academic_year_id` directly, and that is exactly what made two terms of the
same course inexpressible. The cost is that "everything in this year" is now one hop
longer, and that hop appeared in **17 places** across dashboard, reports, grades,
assessments, attendance, teachers and timetable.

Seventeen hand-written copies of the same subquery is how the old codebase ended up with
nine independent spellings of "order students by name" before `STUDENT_NAME_ORDER`
consolidated them. So it is written once, here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.modules.offerings.models import CourseOffering
from app.modules.settings.models import Semester


def offerings_in_year(academic_year_id: uuid.UUID):
    """A WHERE clause selecting offerings whose semester belongs to `academic_year_id`.

    Written as a subquery on `semester_id` rather than a join, so it drops into an existing
    `.where(...)` without the caller having to know whether `Semester` is already joined —
    adding a second join of the same table is a silent cartesian-product bug.

        stmt = stmt.where(offerings_in_year(year.id))
    """
    return CourseOffering.semester_id.in_(
        select(Semester.id).where(Semester.academic_year_id == academic_year_id)
    )


def semesters_in_year(academic_year_id: uuid.UUID):
    """The year's semester ids, for filtering the CHILDREN of an offering.

    `class_enrollments`, `assessments` and `term_grade_snapshots` all carry `semester_id`
    of their own (kept deliberately — see `ClassEnrollment`), so scoping them to a year
    goes through the term, not through the offering.
    """
    return select(Semester.id).where(Semester.academic_year_id == academic_year_id)


def year_id_of_offering(db, offering) -> uuid.UUID | None:
    """The offering's academic-year id, via its semester.

    `classes.academic_year_id` used to answer this with an attribute access, and ~15
    services did exactly that. An offering stores no year (D31), so the hop is a query —
    which is why it lives here rather than being spelled out at each call site.
    """
    return db.scalar(
        select(Semester.academic_year_id).where(Semester.id == offering.semester_id)
    )


def year_of_offering(db, offering):
    """The offering's `AcademicYear` row, via its semester. See `year_id_of_offering`."""
    from app.modules.settings.models import AcademicYear

    return db.scalar(
        select(AcademicYear)
        .join(Semester, Semester.academic_year_id == AcademicYear.id)
        .where(Semester.id == offering.semester_id)
    )
