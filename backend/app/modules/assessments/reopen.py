"""Reopen a closed marking window — Lecturer asks, Dean decides (D47).

Every assessment has a 5-day marking window (`assessments/marking.py`). A Lecturer who
missed it cannot enter marks; their blanks count as 0. This is the way back in, and it
is modelled on the grade revision workflow (`grades/revisions.py`) on purpose — the
college already knows that shape:

  Lecturer   REQUESTS, on an assessment in an offering they own, once its window has
             closed, with a reason. May withdraw while it is pending.
  Dean       DECIDES. Approval sets `assessments.reopened_until` to 23:59 America/Belize
             on `today + granted_days`; entry is open until then and the blanks stop
             counting as 0 until it closes again. Denial records the ruling.

The request writes no mark and moves no window — only the Dean's approval does.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.common.enums import GradeRevisionStatus, GradeStatus, Role
from app.core.errors import Conflict, Forbidden, NotFound, ValidationError
from app.core.rbac import assert_teacher_owns_offering, hod_offering_ids, hod_program_ids
from app.core.timeutil import SCHOOL_TIMEZONE, ensure_aware, school_today, utcnow
from app.modules.assessments import marking
from app.modules.assessments.models import Assessment, AssessmentReopenRequest
from app.modules.assessments.schemas import (
    ReopenDecisionRequest,
    ReopenRequestCreate,
    ReopenRequestList,
    ReopenRequestRead,
)
from app.modules.offerings.labels import offering_ref
from app.modules.offerings.models import ClassEnrollment, Course, CourseOffering
from app.modules.settings.models import AuditLog
from app.modules.users.models import User

#: Who may file a request: the lecturer roles. Ownership is checked per offering.
_REQUESTERS = (Role.TEACHER, Role.HOD)


def _audit(db: Session, *, actor: User, action: str, entity_id: uuid.UUID, summary: dict) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="assessment_reopen",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _request_or_404(db: Session, request_id: uuid.UUID) -> AssessmentReopenRequest:
    row = db.get(AssessmentReopenRequest, request_id)
    if row is None:
        raise NotFound("Reopen request not found.", code="not_found")
    return row


def _blank_count(db: Session, assessment: Assessment) -> int:
    """Roster members with no mark: active enrolments minus results that are not pending."""
    from app.modules.grades.models import AssessmentGrade

    enrolled = select(ClassEnrollment.student_id).where(
        ClassEnrollment.offering_id == assessment.offering_id,
        ClassEnrollment.semester_id == assessment.semester_id,
        ClassEnrollment.unenrolled_at.is_(None),
    )
    roster = db.scalar(select(func.count()).select_from(enrolled.subquery())) or 0
    marked = (
        db.scalar(
            select(func.count())
            .select_from(AssessmentGrade)
            .where(
                AssessmentGrade.assessment_id == assessment.id,
                AssessmentGrade.status != GradeStatus.PENDING,
                AssessmentGrade.student_id.in_(enrolled),
            )
        )
        or 0
    )
    return max(0, roster - marked)


def _read(db: Session, row: AssessmentReopenRequest, *, actor: User | None) -> ReopenRequestRead:
    assessment = db.get(Assessment, row.assessment_id)
    offering = db.get(CourseOffering, assessment.offering_id) if assessment else None
    course = db.get(Course, offering.course_id) if offering else None
    requester = db.get(User, row.requested_by_user_id)
    decider = db.get(User, row.decided_by_user_id) if row.decided_by_user_id else None
    return ReopenRequestRead(
        id=row.id,
        assessment_id=row.assessment_id,
        assessment_title=assessment.title if assessment else "",
        assessment_date=assessment.assessment_date if assessment else None,
        max_score=float(assessment.max_score) if assessment else None,
        offering=offering_ref(offering, course) if offering and course else None,
        status=row.status,
        reason=row.reason,
        granted_days=row.granted_days,
        decision_note=row.decision_note,
        decided_at=row.decided_at,
        created_at=row.created_at,
        marking_closes_at=marking.marking_closes_at(assessment) if assessment else None,
        reopened_until=ensure_aware(assessment.reopened_until) if assessment else None,
        blank_count=_blank_count(db, assessment) if assessment else 0,
        requested_by_user_id=row.requested_by_user_id,
        requested_by_name=requester.full_name if requester else "",
        decided_by_user_id=row.decided_by_user_id,
        decided_by_name=decider.full_name if decider else None,
        can_withdraw=(
            row.status == GradeRevisionStatus.PENDING
            and actor is not None
            and actor.id == row.requested_by_user_id
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Counting — the bell badge
# ──────────────────────────────────────────────────────────────────────────────
def pending_for_actor(db: Session, *, actor: User) -> int:
    """Requests awaiting THIS caller's decision — non-zero only for the Dean, so the
    badge means "this needs you" (same rule as `grades.revisions.pending_for_actor`)."""
    if actor.role != Role.PRINCIPAL:
        return 0
    return (
        db.scalar(
            select(func.count())
            .select_from(AssessmentReopenRequest)
            .where(AssessmentReopenRequest.status == GradeRevisionStatus.PENDING)
        )
        or 0
    )


def pending_ids_by_assessment(
    db: Session, assessment_ids: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """`{assessment_id: pending request id}` — one query, for the gradebook."""
    if not assessment_ids:
        return {}
    rows = db.execute(
        select(AssessmentReopenRequest.assessment_id, AssessmentReopenRequest.id).where(
            AssessmentReopenRequest.assessment_id.in_(assessment_ids),
            AssessmentReopenRequest.status == GradeRevisionStatus.PENDING,
        )
    ).all()
    return {a_id: r_id for a_id, r_id in rows}


# ──────────────────────────────────────────────────────────────────────────────
# GET /assessment-reopen-requests
# ──────────────────────────────────────────────────────────────────────────────
def list_requests(
    db: Session,
    *,
    actor: User,
    status: GradeRevisionStatus | None,
    offering_id: uuid.UUID | None,
) -> ReopenRequestList:
    """`?status=pending` is the Dean's work list. The Dean and the Auditor see all; a
    Lecturer sees their own; a head of department sees their own plus their programme's
    (the D43 rule the revision queue already follows)."""
    if actor.role not in (Role.PRINCIPAL, Role.TEACHER, Role.HOD, Role.AUDITOR):
        raise Forbidden(
            "Reopen requests are visible to the Dean and to the requesting Lecturer.",
            code="forbidden",
        )
    stmt = select(AssessmentReopenRequest)
    if actor.role == Role.TEACHER:
        stmt = stmt.where(AssessmentReopenRequest.requested_by_user_id == actor.id)
    elif actor.role == Role.HOD:
        scope = hod_offering_ids(db, hod_program_ids(db, actor))
        stmt = stmt.where(
            or_(
                AssessmentReopenRequest.requested_by_user_id == actor.id,
                AssessmentReopenRequest.assessment_id.in_(
                    select(Assessment.id).where(Assessment.offering_id.in_(scope))
                ),
            )
        )
    if status is not None:
        stmt = stmt.where(AssessmentReopenRequest.status == status)
    if offering_id is not None:
        stmt = stmt.where(
            AssessmentReopenRequest.assessment_id.in_(
                select(Assessment.id).where(Assessment.offering_id == offering_id)
            )
        )
    # Oldest first, `id` as the tiebreak — `created_at` has whole-second precision.
    rows = db.scalars(
        stmt.order_by(AssessmentReopenRequest.created_at.asc(), AssessmentReopenRequest.id.asc())
    ).all()
    return ReopenRequestList(
        items=[_read(db, row, actor=actor) for row in rows],
        pending_for_me=pending_for_actor(db, actor=actor),
    )


# ──────────────────────────────────────────────────────────────────────────────
# POST /assessments/{id}/reopen-requests — the LECTURER asks
# ──────────────────────────────────────────────────────────────────────────────
def create_request(
    db: Session, *, actor: User, assessment_id: uuid.UUID, payload: ReopenRequestCreate
) -> ReopenRequestRead:
    """Guards, in order: the Lecturer owns the offering (404 otherwise, no existence
    leak); the session is still writable (a reopen there could never be used); the
    window really is closed (409 `marking_open` — just enter the marks); nothing is
    already pending (409, backed by `uq_assessment_reopen_open`)."""
    from app.modules.assessments.service import _assert_cs_year_writable

    if actor.role not in _REQUESTERS:
        raise Forbidden(
            "Only the Lecturer who teaches the course may ask to reopen marking.",
            code="forbidden",
        )
    assessment = db.scalar(
        select(Assessment).where(Assessment.id == assessment_id, Assessment.deleted_at.is_(None))
    )
    if assessment is None:
        raise NotFound("Assessment not found.", code="not_found")
    assert_teacher_owns_offering(db, actor, assessment.offering_id)
    _assert_cs_year_writable(db, db.get(CourseOffering, assessment.offering_id))

    if marking.is_marking_open(assessment):
        raise Conflict(
            "Marking is still open for this assessment — enter the marks directly.",
            code="marking_open",
        )
    existing = db.scalar(
        select(AssessmentReopenRequest.id).where(
            AssessmentReopenRequest.assessment_id == assessment.id,
            AssessmentReopenRequest.status == GradeRevisionStatus.PENDING,
        )
    )
    if existing is not None:
        raise Conflict(
            "A reopen request for this assessment is already awaiting the Dean.",
            code="reopen_already_pending",
        )

    row = AssessmentReopenRequest(
        assessment_id=assessment.id,
        requested_by_user_id=actor.id,
        reason=payload.reason.strip(),
        status=GradeRevisionStatus.PENDING,
    )
    db.add(row)
    db.flush()
    _audit(
        db, actor=actor, action="assessment_reopen.request", entity_id=row.id,
        summary={"assessment_id": str(assessment.id), "reason": row.reason},
    )
    db.commit()
    return _read(db, row, actor=actor)


def withdraw_request(db: Session, *, actor: User, request_id: uuid.UUID) -> None:
    """The requester withdraws a PENDING request — a hard delete, since it carries no
    ruling. A decided request is the record and is never removed."""
    row = _request_or_404(db, request_id)
    if row.requested_by_user_id != actor.id:
        raise NotFound("Reopen request not found.", code="not_found")
    if row.status != GradeRevisionStatus.PENDING:
        raise Conflict(
            f"This request has already been {row.status.value}; the Dean's decision is kept.",
            code="reopen_decided",
        )
    _audit(
        db, actor=actor, action="assessment_reopen.withdraw", entity_id=row.id,
        summary={"assessment_id": str(row.assessment_id)},
    )
    db.delete(row)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# POST /assessment-reopen-requests/{id}/decision — the DEAN rules
# ──────────────────────────────────────────────────────────────────────────────
def reopen_until_for(days: int) -> datetime:
    """23:59:59 America/Belize on `today + days`, as aware UTC — the same end-of-day
    rule as the original window, so "2 days" means through the end of the day after
    tomorrow, not 48 hours from whenever the Dean happened to click."""
    last_day = school_today() + timedelta(days=days)
    return ensure_aware(datetime.combine(last_day, time(23, 59, 59), tzinfo=SCHOOL_TIMEZONE))


def decide_request(
    db: Session, *, actor: User, request_id: uuid.UUID, payload: ReopenDecisionRequest
) -> ReopenRequestRead:
    """DEAN ONLY (router gate). Approval moves `reopened_until` — never backwards, so a
    later, shorter approval cannot cut short a reopen already running."""
    row = _request_or_404(db, request_id)
    if row.status != GradeRevisionStatus.PENDING:
        raise Conflict(f"This request has already been {row.status.value}.", code="reopen_decided")
    if payload.status == GradeRevisionStatus.PENDING:
        raise ValidationError(
            "A decision must be approved or denied.",
            code="validation_error",
            fields={"status": ["Use approved or denied."]},
        )
    assessment = db.get(Assessment, row.assessment_id)
    if assessment is None:  # pragma: no cover - CASCADE keeps these in step
        raise NotFound("The assessment no longer exists.", code="not_found")

    until = None
    if payload.status == GradeRevisionStatus.APPROVED:
        until = reopen_until_for(payload.granted_days)
        current = ensure_aware(assessment.reopened_until)
        assessment.reopened_until = until if current is None else max(current, until)
        assessment.updated_by = actor.id
        row.granted_days = payload.granted_days

    row.status = payload.status
    row.decided_by_user_id = actor.id
    row.decided_at = utcnow()
    row.decision_note = payload.decision_note
    _audit(
        db, actor=actor, action=f"assessment_reopen.{payload.status.value}", entity_id=row.id,
        summary={
            "assessment_id": str(assessment.id),
            "granted_days": row.granted_days,
            "reopened_until": until.isoformat() if until else None,
            "requested_by_user_id": str(row.requested_by_user_id),
            "decision_note": payload.decision_note,
        },
    )
    db.commit()
    return _read(db, row, actor=actor)
