"""GET /grades/assessment-report — the printable assessment report (D47).

One section per course offering: its assessments as columns, every student as a row
with their marks and current term %. The Dean narrows it by session, offering, student
and lecturer; a Lecturer (or a head of department, who is a lecturer) gets ONLY the
offerings they teach, whatever they pass.

**Built on `get_gradebook`, not beside it.** The report is the gradebook printed, so it
is assembled from the very same call: the marks, the automatic zeros and the term % on
paper are the ones on screen, and there is no second grade computation to drift.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.core.errors import NotFound
from app.core.rbac import teacher_offering_ids
from app.core.timeutil import utcnow
from app.modules.grades import service as grades_service
from app.modules.grades.schemas import (
    AssessmentReport,
    AssessmentReportColumn,
    AssessmentReportOffering,
    AssessmentReportRow,
)
from app.modules.offerings.labels import OFFERING_ORDER
from app.modules.offerings.models import ClassEnrollment, ClassTeacher, Course, CourseOffering
from app.modules.offerings.queries import offerings_in_year
from app.modules.settings.models import Semester
from app.modules.users.models import User

#: A college-wide print with no filter at all would be hundreds of pages. The Dean is
#: told how many matched and narrows down; the first this-many are printed.
MAX_OFFERINGS = 60


def _active_semester_id(db: Session) -> uuid.UUID | None:
    return db.scalar(select(Semester.id).where(Semester.is_active.is_(True)).limit(1))


def build_report(
    db: Session,
    *,
    actor: User,
    academic_year_id: uuid.UUID | None,
    semester_id: uuid.UUID | None,
    offering_id: uuid.UUID | None,
    student_id: uuid.UUID | None,
    teacher_id: uuid.UUID | None,
) -> AssessmentReport:
    is_lecturer = actor.role in (Role.TEACHER, Role.HOD)

    stmt = (
        select(CourseOffering.id)
        .join(Course, Course.id == CourseOffering.course_id)
        .where(CourseOffering.deleted_at.is_(None))
    )
    if is_lecturer:
        # Own offerings only — `teacher_id` is ignored rather than honoured, so no value
        # of it can widen the set. An explicitly named offering they don't teach is a
        # 404, the same no-existence-leak answer the gradebook gives.
        owned = teacher_offering_ids(db, actor)
        if offering_id is not None and offering_id not in set(owned):
            raise NotFound("Offering not found.", code="not_found")
        stmt = stmt.where(CourseOffering.id.in_(owned or [uuid.UUID(int=0)]))
    elif teacher_id is not None:
        stmt = stmt.where(
            CourseOffering.id.in_(
                select(ClassTeacher.offering_id).where(ClassTeacher.teacher_id == teacher_id)
            )
        )

    if offering_id is not None:
        stmt = stmt.where(CourseOffering.id == offering_id)
    if student_id is not None:
        stmt = stmt.where(
            CourseOffering.id.in_(
                select(ClassEnrollment.offering_id).where(
                    ClassEnrollment.student_id == student_id,
                    ClassEnrollment.unenrolled_at.is_(None),
                )
            )
        )
    # No term named and nothing that pins one down: default to the current session
    # rather than printing every term the college has ever run.
    if semester_id is None and academic_year_id is None and offering_id is None and student_id is None:
        semester_id = _active_semester_id(db)
    if semester_id is not None:
        stmt = stmt.where(CourseOffering.semester_id == semester_id)
    if academic_year_id is not None:
        stmt = stmt.where(offerings_in_year(academic_year_id))

    ids = list(db.scalars(stmt.order_by(*OFFERING_ORDER)).all())
    total = len(ids)

    sections: list[AssessmentReportOffering] = []
    for cs_id in ids[:MAX_OFFERINGS]:
        book = grades_service.get_gradebook(db, actor=actor, offering_id=cs_id, semester_id=None)
        categories = {c.id: c.name for c in book.categories}
        rows = [
            AssessmentReportRow(
                student=row.student,
                cells=row.cells,
                term_numeric=row.term_numeric,
                term_letter=row.term_letter,
            )
            for row in book.rows
            if row.is_active_member and (student_id is None or row.student.id == student_id)
        ]
        sections.append(
            AssessmentReportOffering(
                offering=book.offering,
                semester=book.semester,
                assessments=[
                    AssessmentReportColumn(
                        id=a.id,
                        title=a.title,
                        category_name=categories.get(a.category_id) if a.category_id else None,
                        assessment_date=a.assessment_date,
                        max_score=a.max_score,
                        marking_open=a.marking_open,
                        effective_closes_at=a.effective_closes_at,
                    )
                    for a in book.assessments
                ],
                rows=rows,
            )
        )

    return AssessmentReport(
        generated_at=utcnow(),
        total_offerings=total,
        truncated=total > MAX_OFFERINGS,
        offerings=sections,
    )
