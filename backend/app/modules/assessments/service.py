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
from datetime import datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import AssessmentStatus, Role
from app.core.errors import Conflict, NotFound, RateLimited, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id, assert_teacher_owns_offering
from app.core.timeutil import utcnow
from app.modules.assessments import release_nudge
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.assessments.schemas import (
    AssessmentDetail,
    AssessmentListItem,
    AssessmentStats,
    CategoryDetail,
    OfferingRef,
    NudgedTeacher,
    NudgeReleaseResult,
    ReleaseResult,
)
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.queries import offerings_in_year, year_of_offering
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

# Legal assessment lifecycle transitions (API-16). `graded` is terminal.
_LEGAL_TRANSITIONS: dict[AssessmentStatus, set[AssessmentStatus]] = {
    AssessmentStatus.DRAFT: {AssessmentStatus.PUBLISHED},
    AssessmentStatus.PUBLISHED: {AssessmentStatus.GRADING, AssessmentStatus.DRAFT},
    AssessmentStatus.GRADING: {AssessmentStatus.GRADED, AssessmentStatus.PUBLISHED},
    AssessmentStatus.GRADED: set(),
}

_SORT_FIELDS = {
    "assessment_date": Assessment.assessment_date,
    "title": Assessment.title,
    "created_at": Assessment.created_at,
    "status": Assessment.status,
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


def _active_semester_id(db: Session) -> uuid.UUID | None:
    return db.scalar(select(Semester.id).where(Semester.is_active.is_(True)))


def _assert_cs_year_writable(db: Session, cs: CourseOffering) -> None:
    section = cs  # D31: the offering IS the section
    if section is not None and section.is_archived:
        raise Conflict("The academic year is archived.", code="year_archived")
    if section is not None:
        year = year_of_offering(db, section)
        if year is not None and year.archived_at is not None:
            raise Conflict("The academic year is archived.", code="year_archived")


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
def _list_item(a: Assessment, cls: CourseOffering, subj: Course) -> AssessmentListItem:
    return AssessmentListItem(
        id=a.id, title=a.title, type=a.type,
        offering=offering_ref(cls, subj),
        category_id=a.category_id, max_score=float(a.max_score),
        weight=float(a.weight), assessment_date=a.assessment_date,
        status=a.status, is_released=a.is_released,
    )


def _detail(db: Session, a: Assessment, *, with_stats: bool) -> AssessmentDetail:
    row = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(CourseOffering.id == a.offering_id)
    ).first()
    cs_ref = offering_ref(row[0], row[1]) if row else None
    return AssessmentDetail(
        id=a.id, title=a.title, type=a.type, offering=cs_ref,
        category_id=a.category_id, max_score=float(a.max_score), weight=float(a.weight),
        assessment_date=a.assessment_date, status=a.status, is_released=a.is_released,
        semester_id=a.semester_id,
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
    type_filter: str | None,
    status_filter: str | None,
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
    if type_filter is not None:
        stmt = stmt.where(Assessment.type == type_filter)
    if status_filter is not None:
        stmt = stmt.where(Assessment.status == status_filter)

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
            stmt = stmt.where(
                CourseOffering.id.in_(section_ids),
                Assessment.status != AssessmentStatus.DRAFT,
            )
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
        if cs is None or cs.id not in section_ids or a.status == AssessmentStatus.DRAFT:
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
    stmt = (
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
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
    refs = [offering_ref(offering, course) for (offering, course) in rows]
    from app.modules.assessments.schemas import OfferingPickerList

    return OfferingPickerList(items=refs)


# ══════════════════════════════════════════════════════════════════════════════
# POST /assessments
# ══════════════════════════════════════════════════════════════════════════════
def create_assessment(db: Session, *, actor: User, payload) -> AssessmentDetail:
    cs = _cs_or_404(db, payload.offering_id)
    assert_teacher_owns_offering(db, actor, cs.id)  # 404 if not owner
    _assert_cs_year_writable(db, cs)

    semester_id = payload.semester_id or _active_semester_id(db)
    if semester_id is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")

    if payload.category_id is not None:
        _assert_category_matches_cs(db, payload.category_id, cs.id)

    a = Assessment(
        offering_id=cs.id,
        semester_id=semester_id,
        category_id=payload.category_id,
        title=payload.title.strip(),
        type=payload.type,
        max_score=payload.max_score,
        weight=payload.weight,
        assessment_date=payload.assessment_date,
        status=AssessmentStatus.DRAFT,
        is_released=False,
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
    if payload.type is not None:
        a.type = payload.type
    if payload.max_score is not None:
        a.max_score = payload.max_score
    if payload.weight is not None:
        a.weight = payload.weight
    if "assessment_date" in fields:
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
# POST /assessments/{id}/status
# ══════════════════════════════════════════════════════════════════════════════
def change_status(db: Session, *, actor: User, assessment_id: uuid.UUID, payload) -> AssessmentDetail:
    a = _assessment_or_404(db, assessment_id)
    assert_teacher_owns_offering(db, actor, a.offering_id)
    cs = db.get(CourseOffering, a.offering_id)
    _assert_cs_year_writable(db, cs)

    # Coerce to the enum — a freshly-inserted row may hold the raw str value.
    before, after = AssessmentStatus(a.status), AssessmentStatus(payload.status)
    if before != after:
        if after not in _LEGAL_TRANSITIONS.get(before, set()):
            raise ValidationError(
                f"Cannot change status from '{before.value}' to '{after.value}'.",
                code="invalid_transition",
                fields={"status": [f"Invalid transition from {before.value}."]},
            )
        a.status = after
        a.updated_by = actor.id
        _audit(db, actor=actor, action="assessment.status_change", entity_id=a.id,
               summary={"before": before.value, "after": after.value})
        db.commit()
    return _detail(db, a, with_stats=True)


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /assessments/{id}
# ══════════════════════════════════════════════════════════════════════════════
def delete_assessment(db: Session, *, actor: User, assessment_id: uuid.UUID) -> None:
    a = _assessment_or_404(db, assessment_id)
    assert_teacher_owns_offering(db, actor, a.offering_id)
    cs = db.get(CourseOffering, a.offering_id)
    _assert_cs_year_writable(db, cs)

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
# POST /assessments/{id}/release  +  /unrelease
# ══════════════════════════════════════════════════════════════════════════════
def set_release(
    db: Session,
    *,
    actor: User,
    assessment_id: uuid.UUID,
    released: bool,
    student_ids: list[uuid.UUID] | None = None,
) -> ReleaseResult:
    """Release/unrelease grades for an assessment (api-spec §7).

    Two modes. The read path everywhere is `grade.is_released ?? assessment.is_released`,
    which is what makes the reset below necessary rather than optional.

    * **Whole-column** (`student_ids is None`) — flip `assessments.is_released` AND
      **reset every grade row's `is_released` back to NULL**. Without the reset, a
      row left at `False` by an earlier per-student unrelease would keep
      overriding the column and silently stay hidden after the teacher released
      the whole assessment.
    * **Per-student** — flip only the named rows' `is_released`, leaving the
      assessment column alone. Rows that don't exist are ignored.
    """
    a = _assessment_or_404(db, assessment_id)
    assert_teacher_owns_offering(db, actor, a.offering_id)
    cs = db.get(CourseOffering, a.offering_id)
    _assert_cs_year_writable(db, cs)

    from app.modules.grades.models import AssessmentGrade

    if student_ids is not None:
        targets = list(dict.fromkeys(student_ids))  # de-dupe, preserve order
        released_count = 0
        if targets:
            released_count = db.query(AssessmentGrade).filter(
                AssessmentGrade.assessment_id == a.id,
                AssessmentGrade.student_id.in_(targets),
            ).update({"is_released": released, "updated_by": actor.id}, synchronize_session=False)
        a.updated_by = actor.id
        # `is_released` on the response reflects the ASSESSMENT column, which a
        # per-student call deliberately does not touch.
        effective = a.is_released
    else:
        a.is_released = released
        a.released_at = utcnow() if released else None
        a.updated_by = actor.id
        db.query(AssessmentGrade).filter(
            AssessmentGrade.assessment_id == a.id,
            AssessmentGrade.is_released.isnot(None),
        ).update({"is_released": None}, synchronize_session=False)
        released_count = db.scalar(
            select(func.count()).select_from(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id
            )
        ) or 0
        effective = released

    _audit(db, actor=actor, action="grade.release" if released else "grade.unrelease",
           entity_id=a.id,
           summary={"student_ids": [str(s) for s in student_ids]} if student_ids is not None else None)
    db.commit()
    return ReleaseResult(assessment_id=a.id, is_released=effective, released_count=released_count)


# ══════════════════════════════════════════════════════════════════════════════
# POST /assessments/{id}/nudge-release
# ══════════════════════════════════════════════════════════════════════════════
def nudge_release(
    db: Session, *, actor: User, assessment_id: uuid.UUID
) -> NudgeReleaseResult:
    """Remind the teacher(s) that this assessment holds marked-but-hidden grades.

    Principal/secretary only (gated at the router by `require_role`, like every
    other coarse role gate in this module). The 404-not-403 discipline used
    elsewhere is an OWNERSHIP rule — it stops a teacher confirming that an offering
    they don't own exists. It does not apply here: P/S are view-all, so there is no
    resource whose existence a permitted caller could learn by being refused. A
    teacher or student hitting this route gets the module's usual 403 from the gate.

    **Delivery is the audit row plus the teacher's dashboard tile** — no email, no
    announcement, no notifications table. The teacher already has a standing
    "awaiting release" queue (`TeacherDashboard.awaiting_release`); this endpoint
    records that a specific human asked for a specific assessment, which is what
    makes it auditable rather than just a UI badge.

    Four refusals, in order:

    * **404** — unknown or soft-deleted assessment.
    * **409 `year_archived`** — the section's year is archived, so
      `POST /{id}/release` would itself 409. Nudging someone to perform an action
      the system will reject is worse than useless, so the same guard applies.
    * **409 `no_assigned_teacher`** — the offering is unstaffed (the secretary
      dashboard already surfaces this as a setup task). A reminder addressed to
      nobody must fail loudly, not be recorded as delivered.
    * **409 `nothing_awaiting_release`** — nothing is marked-and-hidden, so there is
      nothing to release. Silently succeeding here would let the UI report a
      reminder that had no possible subject.
    * **429 `rate_limited`** — a nudge for this assessment is inside the cooldown.

    Idempotency/replay: a retried POST inside the window is absorbed by the 429
    rather than appending a duplicate audit row, so a double-submit cannot inflate
    the trail.
    """
    a = _assessment_or_404(db, assessment_id)
    cs = _cs_or_404(db, a.offering_id)
    _assert_cs_year_writable(db, cs)

    teachers = db.execute(
        select(TeacherProfile.id, TeacherProfile.full_name)
        .join(ClassTeacher, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(
            ClassTeacher.offering_id == cs.id,
            TeacherProfile.deleted_at.is_(None),
        )
        .order_by(ClassTeacher.is_lead.desc(), TeacherProfile.full_name.asc())
    ).all()
    if not teachers:
        raise Conflict(
            "This subject offering has no assigned teacher to remind.",
            code="no_assigned_teacher",
        )

    awaiting = release_nudge.count_awaiting_release(db, a.id)
    if awaiting == 0:
        raise Conflict(
            "Nothing is awaiting release for this assessment.",
            code="nothing_awaiting_release",
        )

    now = utcnow()
    previous = release_nudge.last_nudged_at(db, a.id)
    if previous is not None and now - previous < release_nudge.NUDGE_COOLDOWN:
        retry_after = int((previous + release_nudge.NUDGE_COOLDOWN - now).total_seconds())
        raise RateLimited(
            "This teacher was reminded recently. Try again later.",
            extra={
                "retry_after_seconds": max(retry_after, 1),
                "last_nudged_at": previous.isoformat(),
                "cooldown_seconds": release_nudge.NUDGE_COOLDOWN_SECONDS,
            },
        )

    at = release_nudge.record_nudge(
        db,
        actor=actor,
        assessment_id=a.id,
        summary={
            "offering_id": str(cs.id),
            "awaiting_release_count": awaiting,
            # Names, not just ids, so the trail stays readable after a teacher row
            # is renamed or soft-deleted. No contact details — audit rows are not
            # a place for PII beyond what the action needs.
            "teacher_ids": [str(t_id) for t_id, _ in teachers],
            "teacher_names": [name for _, name in teachers],
        },
    )
    db.commit()

    return NudgeReleaseResult(
        assessment_id=a.id,
        awaiting_release_count=awaiting,
        teachers=[NudgedTeacher(id=t_id, full_name=name) for t_id, name in teachers],
        last_nudged_at=at,
        next_nudge_allowed_at=at + release_nudge.NUDGE_COOLDOWN,
        cooldown_seconds=release_nudge.NUDGE_COOLDOWN_SECONDS,
    )


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
    if caller.role in (Role.PRINCIPAL, Role.SECRETARY):
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


def create_category(db: Session, *, actor: User, offering_id, payload):
    cs = _offering_or_404(db, offering_id)
    assert_teacher_owns_offering(db, actor, cs.id)
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
    assert_teacher_owns_offering(db, actor, cs.id)
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
    assert_teacher_owns_offering(db, actor, cs.id)
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
