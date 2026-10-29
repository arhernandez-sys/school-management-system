"""Assessments service (api-spec Module 6, FR-ASMT-01..12).

Owns DB access + transactions for the assessment + category endpoints; routers are
thin. Writes are teacher-only (P/S are view-all, OQ-API-2) and gated by
`assert_teacher_owns_offering`. Reads are scoped: P/S view-all, Teacher to
owned offerings, Student to the offerings they are enrolled in (non-draft only).

Every write rejects an assessment whose section's academic year is archived → 409
year_archived (schema §5 rule 7). Datetime comparisons use `ensure_aware` for
MariaDB/Postgres portability.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import AssessmentStatus, Role
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id, assert_teacher_owns_offering
from app.core.timeutil import school_today, utcnow
from app.modules.assessments import marking
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.assessments.schemas import (
    AssessmentDetail,
    AssessmentListItem,
    AssessmentStats,
    CategoryDetail,
    OfferingRef,
)
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.queries import (
    assert_offering_session_active,
    offerings_in_year,
    year_of_offering,
)
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User


def _dec(value) -> Decimal | None:  # noqa: ANN001
    """Coerce a stored Numeric to `Decimal`, or None if it is not a number.

    Local rather than imported from `grades.calc`: this module already avoids importing
    the grade engine, and the D45 §24 weighting check needs exact decimal arithmetic for
    one reason only — 20 + 15 + 25 + 30 + 10 is exactly 100 in decimal and
    99.99999999999999 in binary float, so a float sum would tell a lecturer their correct
    gradebook was wrong.
    """
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None

_SORT_FIELDS = {
    "assessment_date": Assessment.assessment_date,
    "title": Assessment.title,
    "created_at": Assessment.created_at,
}


def _audit(db, *, actor, action, entity_type="assessment", entity_id=None, summary=None):
    db.add(AuditLog(actor_user_id=actor.id, action=action, entity_type=entity_type,
                    entity_id=entity_id, summary=summary))


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + guards
# ──────────────────────────────────────────────────────────────────────────────
def _cs_or_404(db: Session, offering_id: uuid.UUID) -> CourseOffering:
    cs = db.scalar(
        select(CourseOffering).where(
            CourseOffering.id == offering_id, CourseOffering.deleted_at.is_(None)
        )
    )
    if cs is None:
        raise NotFound("Offering not found.", code="offering_not_found")
    return cs


def _assessment_or_404(db: Session, assessment_id: uuid.UUID) -> Assessment:
    a = db.scalar(
        select(Assessment).where(
            Assessment.id == assessment_id, Assessment.deleted_at.is_(None)
        )
    )
    if a is None:
        raise NotFound("Assessment not found.", code="not_found")
    return a


def _assert_cs_year_writable(db: Session, cs: CourseOffering) -> None:
    section = cs  # D31: the offering IS the section
    if section is not None and section.is_archived:
        raise Conflict("The academic year is archived.", code="year_archived")
    if section is not None:
        year = year_of_offering(db, section)
        if year is not None and year.archived_at is not None:
            raise Conflict("The academic year is archived.", code="year_archived")
    # Only the active session's assessments and categories may change.
    assert_offering_session_active(db, cs)


def _offering_ref_by_id(db: Session, offering_id: uuid.UUID) -> OfferingRef | None:
    """Load an offering + its course and shape the shared ref, or None if it is gone.

    Returns None rather than a half-built ref: `OfferingRef.label` is required, and a ref
    naming nothing was only expressible while the label was optional.
    """
    row = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(CourseOffering.id == offering_id)
    ).first()
    return offering_ref(row[0], row[1]) if row is not None else None


def _stats(db: Session, assessment_id: uuid.UUID) -> AssessmentStats:
    from app.modules.grades.models import AssessmentGrade

    rows = db.execute(
        select(AssessmentGrade.status, func.count())
        .where(AssessmentGrade.assessment_id == assessment_id)
        .group_by(AssessmentGrade.status)
    ).all()
    by_status = {str(s): n for (s, n) in rows}
    total = sum(by_status.values())
    return AssessmentStats(
        grade_count=total,
        graded_count=by_status.get("graded", 0),
        pending_count=by_status.get("pending", 0),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Shaping
# ──────────────────────────────────────────────────────────────────────────────
def _marking_fields(a: Assessment) -> dict:
    state = marking.marking_state(a)
    return {
        "marking_open": state.open,
        "marking_closes_at": state.closes_at,
        "reopened_until": state.reopened_until,
        "effective_closes_at": state.effective_closes_at,
        "days_left": state.days_left,
    }


def _list_item(a: Assessment, cls: CourseOffering, subj: Course) -> AssessmentListItem:
    return AssessmentListItem(
        id=a.id, title=a.title,
        offering=offering_ref(cls, subj),
        category_id=a.category_id, max_score=float(a.max_score),
        weight=float(a.weight), assessment_date=a.assessment_date,
        **_marking_fields(a),
    )


def _detail(db: Session, a: Assessment, *, with_stats: bool) -> AssessmentDetail:
    row = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(CourseOffering.id == a.offering_id)
    ).first()
    cs_ref = offering_ref(row[0], row[1]) if row else None
    return AssessmentDetail(
        id=a.id, title=a.title, offering=cs_ref,
        category_id=a.category_id, max_score=float(a.max_score), weight=float(a.weight),
        assessment_date=a.assessment_date, semester_id=a.semester_id,
        **_marking_fields(a),
        stats=_stats(db, a.id) if with_stats else None,
    )


def _student_profile_id(db: Session, user: User) -> uuid.UUID | None:
    return db.scalar(
        select(StudentProfile.id).where(
            StudentProfile.user_id == user.id, StudentProfile.deleted_at.is_(None)
        )
    )


def _student_section_ids(db: Session, sp_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.execute(
            select(ClassEnrollment.offering_id).where(
                ClassEnrollment.student_id == sp_id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        ).scalars()
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /assessments
# ══════════════════════════════════════════════════════════════════════════════
def list_assessments(
    db: Session,
    *,
    caller: User,
    params: PageParams,
    offering_id: uuid.UUID | None,
    academic_year_id: uuid.UUID | None,
    semester_id: uuid.UUID | None,
    scope: str | None,
):
    stmt = (
        select(Assessment, CourseOffering, Course)
        .join(CourseOffering, Assessment.offering_id == CourseOffering.id)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(Assessment.deleted_at.is_(None))
    )

    if offering_id is not None:
        stmt = stmt.where(Assessment.offering_id == offering_id)
    if academic_year_id is not None:
        stmt = stmt.where(offerings_in_year(academic_year_id))
    if semester_id is not None:
        # Narrows WITHIN a year: `Assessment.semester_id` is the assessment's own term,
        # while `academic_year_id` above filters on the section's year. Both may be sent.
        stmt = stmt.where(Assessment.semester_id == semester_id)

    # Scope
    if caller.role == Role.TEACHER:
        teacher_id = _teacher_profile_id(db, caller)
        owns = (
            select(ClassTeacher.id)
            .where(
                ClassTeacher.offering_id == Assessment.offering_id,
                ClassTeacher.teacher_id == teacher_id,
            )
            .exists()
        )
        stmt = stmt.where(owns)
    elif caller.role == Role.STUDENT:
        sp_id = _student_profile_id(db, caller)
        section_ids = _student_section_ids(db, sp_id) if sp_id else []
        if not section_ids:
            stmt = stmt.where(False)
        else:
            stmt = stmt.where(CourseOffering.id.in_(section_ids))
    # P/S: no scope filter (view-all).

    # Sort (default newest-first by date).
    sort = (params.sort or "-assessment_date").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(f"Unknown sort field '{key}'.", code="invalid_sort_field")
    # NULLS LAST portable for date sort
    stmt = stmt.order_by(
        col.desc() if desc else col.asc(),
        Assessment.id.asc(),
    )

    # paginate needs a scalar-entity select; we have a tuple select, so count + window manually.
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.limit(params.page_size).offset((params.page - 1) * params.page_size)
    ).all()
    items = [_list_item(a, cls, subj) for (a, cls, subj) in rows]
    from math import ceil
    from app.common.schemas import Page

    return Page(
        items=items, total=total, page=params.page, page_size=params.page_size,
        total_pages=ceil(total / params.page_size) if params.page_size else 0,
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /assessments/{id}
# ══════════════════════════════════════════════════════════════════════════════
def get_assessment(db: Session, *, caller: User, assessment_id: uuid.UUID) -> AssessmentDetail:
    a = _assessment_or_404(db, assessment_id)
    if caller.role == Role.TEACHER:
        assert_teacher_owns_offering(db, caller, a.offering_id)  # 404 if not
        return _detail(db, a, with_stats=True)
    if caller.role == Role.STUDENT:
        sp_id = _student_profile_id(db, caller)
        cs = db.get(CourseOffering, a.offering_id)
        section_ids = _student_section_ids(db, sp_id) if sp_id else []
        if cs is None or cs.id not in section_ids:
            raise NotFound("Assessment not found.", code="not_found")
        return _detail(db, a, with_stats=False)
    # P/S
    return _detail(db, a, with_stats=True)


# ══════════════════════════════════════════════════════════════════════════════
# GET /assessments/offerings — picker feed
# ══════════════════════════════════════════════════════════════════════════════
def list_offerings_picker(
    db: Session, *, caller: User, academic_year_id: uuid.UUID | None
):
    # The semester rides along: the staff screens filter this feed by the session picked
    # beside the year, so an offering without one matched no session and the picker was
    # always empty.
    stmt = (
        select(CourseOffering, Course, Semester)
        .join(Course, CourseOffering.course_id == Course.id)
        .outerjoin(Semester, CourseOffering.semester_id == Semester.id)
        .where(CourseOffering.deleted_at.is_(None))
    )
    if academic_year_id is not None:
        stmt = stmt.where(offerings_in_year(academic_year_id))

    if caller.role == Role.TEACHER:
        teacher_id = _teacher_profile_id(db, caller)
        owns = (
            select(ClassTeacher.id)
            .where(
                ClassTeacher.offering_id == CourseOffering.id,
                ClassTeacher.teacher_id == teacher_id,
            )
            .exists()
        )
        stmt = stmt.where(owns)
    elif caller.role == Role.STUDENT:
        sp_id = _student_profile_id(db, caller)
        section_ids = _student_section_ids(db, sp_id) if sp_id else []
        stmt = stmt.where(CourseOffering.id.in_(section_ids or [uuid.UUID(int=0)]))

    # Ordered in SQL by course code then section, never by the formatted label — see
    # `OFFERING_ORDER`.
    rows = db.execute(stmt.order_by(*OFFERING_ORDER)).all()
    refs = [offering_ref(offering, course, semester) for (offering, course, semester) in rows]
    from app.modules.assessments.schemas import OfferingPickerList

    return OfferingPickerList(items=refs)


# Client request, 17 Oct 2026: every assessment counts equally within its category, so the
# weight is locked at 1 server-side. A submitted `weight` is still accepted (older clients
# send it) but ignored. Category weights are unaffected.
FIXED_ASSESSMENT_WEIGHT = 1

# ══════════════════════════════════════════════════════════════════════════════
# POST /assessments
# ══════════════════════════════════════════════════════════════════════════════
def create_assessment(db: Session, *, actor: User, payload) -> AssessmentDetail:
    cs = _cs_or_404(db, payload.offering_id)
    assert_teacher_owns_offering(db, actor, cs.id)  # 404 if not owner
    _assert_cs_year_writable(db, cs)

    # The term comes from the offering, not from "the active semester": the gradebook
    # lists an offering's assessments by `cs.semester_id`, so stamping anything else here
    # made a freshly created assessment invisible ("Assessment not found").
    semester_id = cs.semester_id
    if payload.semester_id is not None and payload.semester_id != semester_id:
        raise Conflict(
            "The assessment's session must match the course offering's session.",
            code="semester_mismatch",
            fields={"semester_id": ["Must be the course offering's session."]},
        )
    _assert_window_not_already_closed(payload.assessment_date)

    if payload.category_id is not None:
        _assert_category_matches_cs(db, payload.category_id, cs.id)

    a = Assessment(
        offering_id=cs.id,
        semester_id=semester_id,
        category_id=payload.category_id,
        title=payload.title.strip(),
        max_score=payload.max_score,
        weight=FIXED_ASSESSMENT_WEIGHT,
        assessment_date=payload.assessment_date,
        # D47 — no lifecycle and no release step: an assessment is live from creation
        # and a saved mark counts at once. The two legacy columns are set to the values
        # that mean exactly that, so nothing still reading them disagrees.
        status=AssessmentStatus.GRADED,
        is_released=True,
        absent_as_zero=payload.absent_as_zero,
        allow_makeup=payload.allow_makeup,
        drop_lowest_count=payload.drop_lowest_count,
        created_by=actor.id,
    )
    db.add(a)
    db.flush()
    _audit(db, actor=actor, action="assessment.create", entity_id=a.id,
           summary={"title": a.title})
    db.commit()
    return _detail(db, a, with_stats=True)


def _assert_category_matches_cs(db: Session, category_id: uuid.UUID, cs_id: uuid.UUID) -> None:
    cat = db.get(AssessmentCategory, category_id)
    if cat is None or cat.offering_id != cs_id:
        raise Conflict(
            "Category does not belong to this subject offering.",
            code="category_subject_mismatch",
        )


# ══════════════════════════════════════════════════════════════════════════════
# PATCH /assessments/{id}
# ══════════════════════════════════════════════════════════════════════════════
def update_assessment(db: Session, *, actor: User, assessment_id: uuid.UUID, payload) -> AssessmentDetail:
    a = _assessment_or_404(db, assessment_id)
    assert_teacher_owns_offering(db, actor, a.offering_id)
    cs = db.get(CourseOffering, a.offering_id)
    _assert_cs_year_writable(db, cs)

    fields = payload.model_fields_set

    if "category_id" in fields:
        if payload.category_id is not None:
            _assert_category_matches_cs(db, payload.category_id, a.offering_id)
        a.category_id = payload.category_id

    if payload.max_score is not None and payload.max_score < float(a.max_score):
        _assert_no_scores_exceed(db, a.id, payload.max_score)

    if payload.title is not None:
        a.title = payload.title.strip()
    if payload.max_score is not None:
        a.max_score = payload.max_score
    # Locked (see FIXED_ASSESSMENT_WEIGHT): any edit also brings an older non-1 weight back to 1.
    a.weight = FIXED_ASSESSMENT_WEIGHT
    if "assessment_date" in fields and payload.assessment_date != a.assessment_date:
        # D47 — the date anchors the marking window, so moving it moves the window.
        # Frozen once closed (the way back in is a reopen request), and a new date may
        # not land in an already-closed window either.
        _assert_marking_open(a)
        _assert_window_not_already_closed(payload.assessment_date)
        a.assessment_date = payload.assessment_date
    if payload.absent_as_zero is not None:
        a.absent_as_zero = payload.absent_as_zero
    if payload.allow_makeup is not None:
        a.allow_makeup = payload.allow_makeup
    if payload.drop_lowest_count is not None:
        a.drop_lowest_count = payload.drop_lowest_count

    a.updated_by = actor.id
    _audit(db, actor=actor, action="assessment.update", entity_id=a.id)
    db.commit()
    return _detail(db, a, with_stats=True)


def _assert_marking_open(a: Assessment) -> None:
    if not marking.is_marking_open(a):
        raise Conflict(
            "The marking window for this assessment has closed. Ask the Dean to "
            "reopen it first.",
            code="marking_closed",
        )


def _assert_window_not_already_closed(assessment_date) -> None:  # noqa: ANN001
    """A date whose whole marking window is already in the past would create an
    assessment that is locked from birth (D47)."""
    if assessment_date is None:
        return
    if assessment_date + timedelta(days=marking.MARKING_WINDOW_DAYS) < school_today():
        raise ValidationError(
            f"The assessment date is more than {marking.MARKING_WINDOW_DAYS} days ago, "
            "so its marking window has already closed.",
            code="marking_window_passed",
            fields={"assessment_date": [
                f"Must be within the last {marking.MARKING_WINDOW_DAYS} days or later."
            ]},
        )


def _assert_no_scores_exceed(db: Session, assessment_id: uuid.UUID, new_max: float) -> None:
    from app.modules.grades.models import AssessmentGrade

    top = db.scalar(
        select(func.max(AssessmentGrade.score)).where(
            AssessmentGrade.assessment_id == assessment_id
        )
    )
    if top is not None and float(top) > new_max:
        raise Conflict(
            "Some recorded scores exceed the new maximum.",
            code="scores_exceed_new_max",
        )


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /assessments/{id}
# ══════════════════════════════════════════════════════════════════════════════
def delete_assessment(db: Session, *, actor: User, assessment_id: uuid.UUID) -> None:
    a = _assessment_or_404(db, assessment_id)
    assert_teacher_owns_offering(db, actor, a.offering_id)
    cs = db.get(CourseOffering, a.offering_id)
    _assert_cs_year_writable(db, cs)
    # D47 — once closed, its blanks already count as 0; deleting it would erase them.
    _assert_marking_open(a)

    from app.modules.grades.models import AssessmentGrade

    has_real_grades = db.scalar(
        select(AssessmentGrade.id).where(
            AssessmentGrade.assessment_id == a.id,
            (AssessmentGrade.score.is_not(None)) | (AssessmentGrade.status != "pending"),
        ).limit(1)
    )
    if has_real_grades is not None:
        raise Conflict(
            "This assessment has recorded grades and cannot be deleted.",
            code="assessment_has_grades",
        )
    # Remove any leftover pending/empty grade rows (FK RESTRICT), then soft-delete.
    for g in db.execute(
        select(AssessmentGrade).where(AssessmentGrade.assessment_id == a.id)
    ).scalars():
        db.delete(g)
    a.deleted_at = utcnow()
    a.updated_by = actor.id
    _audit(db, actor=actor, action="assessment.delete", entity_id=a.id)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Categories: /classes/{class_id}/subjects/{offering_id}/categories
# ══════════════════════════════════════════════════════════════════════════════
def _offering_or_404(db: Session, offering_id: uuid.UUID) -> CourseOffering:
    """D31: one lookup, not two. This used to verify that a class_subject belonged to a
    given class, because the URL threaded both ids. An offering has no parent section."""
    offering = db.scalar(
        select(CourseOffering).where(
            CourseOffering.id == offering_id,
            CourseOffering.deleted_at.is_(None),
        )
    )
    if offering is None:
        raise NotFound("Offering not found.", code="offering_not_found")
    return offering


def _cat_detail(c: AssessmentCategory) -> CategoryDetail:
    return CategoryDetail(
        id=c.id, offering_id=c.offering_id, name=c.name,
        weight=float(c.weight), drop_lowest_count=c.drop_lowest_count or 0,
    )


def list_categories(db: Session, *, caller: User, offering_id: uuid.UUID):
    cs = _offering_or_404(db, offering_id)
    _assert_can_read_cs(db, caller, cs)
    rows = db.execute(
        select(AssessmentCategory)
        .where(AssessmentCategory.offering_id == cs.id)
        .order_by(AssessmentCategory.name.asc())
    ).scalars().all()
    from app.modules.assessments.schemas import CategoryList

    # D45 §24 — "The system should verify that assessment weighting totals 100%."
    # Computed with Decimal: 20 + 15 + 25 + 30 + 10 is exactly 100 in decimal and
    # 99.99999999999999 in binary float, so a float sum would tell the lecturer their
    # correct gradebook was wrong.
    total = sum((_dec(c.weight) or Decimal(0) for c in rows), start=Decimal(0))
    uncategorized = db.scalar(
        select(func.count())
        .select_from(Assessment)
        .where(
            Assessment.offering_id == cs.id,
            Assessment.category_id.is_(None),
            Assessment.deleted_at.is_(None),
        )
    ) or 0
    return CategoryList(
        items=[_cat_detail(c) for c in rows],
        weight_total=float(total),
        weight_total_ok=bool(rows) and total == Decimal(100) and uncategorized == 0,
        uncategorized_assessment_count=int(uncategorized),
    )


def _assert_can_read_cs(db: Session, caller: User, cs: CourseOffering) -> None:
    # The weighting scheme is shown on the offering page, which the Auditor and the HOD
    # can open for offerings they do not teach. Before this, both fell through to the
    # STUDENT branch below and got a 404 for an offering they could plainly see.
    if caller.role in (Role.PRINCIPAL, Role.SECRETARY, Role.AUDITOR, Role.HOD):
        return
    if caller.role == Role.TEACHER:
        assert_teacher_owns_offering(db, caller, cs.id)
        return
    sp_id = _student_profile_id(db, caller)
    section_ids = _student_section_ids(db, sp_id) if sp_id else []
    if cs.id not in section_ids:
        raise NotFound("Offering not found.", code="offering_not_found")


def _assert_cat_name_unique(db, cs_id, name, *, exclude_id=None) -> None:
    stmt = select(AssessmentCategory.id).where(
        AssessmentCategory.offering_id == cs_id,
        func.lower(AssessmentCategory.name) == name.strip().lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(AssessmentCategory.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict("A category with this name already exists.",
                       code="duplicate_category_name")


def _assert_can_write_categories(db: Session, actor: User, cs: CourseOffering) -> None:
    """The offering's lecturer sets its weighting scheme, and so may the Dean.

    The Dean is let in HERE and not on assessments: a category is the course's grading
    policy ("Final 30%"), which is the Dean's to set or correct; an assessment is the
    lecturer's own work and stays theirs (`test_principal_cannot_create`).
    """
    if actor.role == Role.PRINCIPAL:
        return
    assert_teacher_owns_offering(db, actor, cs.id, message="Offering not found.")


def create_category(db: Session, *, actor: User, offering_id, payload):
    cs = _offering_or_404(db, offering_id)
    _assert_can_write_categories(db, actor, cs)
    _assert_cs_year_writable(db, cs)
    _assert_cat_name_unique(db, cs.id, payload.name)
    c = AssessmentCategory(
        offering_id=cs.id, name=payload.name.strip(), weight=payload.weight,
        drop_lowest_count=payload.drop_lowest_count, created_by=actor.id,
    )
    db.add(c)
    db.flush()
    _audit(db, actor=actor, action="category.create", entity_type="assessment_category",
           entity_id=c.id)
    db.commit()
    return _cat_detail(c)


def _category_or_404(db, cs_id, category_id) -> AssessmentCategory:
    c = db.scalar(
        select(AssessmentCategory).where(
            AssessmentCategory.id == category_id,
            AssessmentCategory.offering_id == cs_id,
        )
    )
    if c is None:
        raise NotFound("Category not found.", code="not_found")
    return c


def update_category(db: Session, *, actor: User, offering_id, category_id, payload):
    cs = _offering_or_404(db, offering_id)
    _assert_can_write_categories(db, actor, cs)
    _assert_cs_year_writable(db, cs)
    c = _category_or_404(db, cs.id, category_id)
    if payload.name is not None and payload.name.strip().lower() != c.name.lower():
        _assert_cat_name_unique(db, cs.id, payload.name, exclude_id=c.id)
        c.name = payload.name.strip()
    if payload.weight is not None:
        c.weight = payload.weight
    if payload.drop_lowest_count is not None:
        c.drop_lowest_count = payload.drop_lowest_count
    c.updated_by = actor.id
    _audit(db, actor=actor, action="category.update", entity_type="assessment_category",
           entity_id=c.id)
    db.commit()
    return _cat_detail(c)


def delete_category(db: Session, *, actor: User, offering_id, category_id) -> None:
    cs = _offering_or_404(db, offering_id)
    _assert_can_write_categories(db, actor, cs)
    _assert_cs_year_writable(db, cs)
    c = _category_or_404(db, cs.id, category_id)
    # Detach referencing assessments (FK SET NULL semantics).
    for a in db.execute(
        select(Assessment).where(Assessment.category_id == c.id)
    ).scalars():
        a.category_id = None
    db.delete(c)
    _audit(db, actor=actor, action="category.delete", entity_type="assessment_category",
           entity_id=category_id)
    db.commit()
