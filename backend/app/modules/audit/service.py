"""Audit trail reads (D45 §46, §53).

READ ONLY, and there is no write path here on purpose. `audit_log` is append-only: the
83 actions across the system write it as a side effect of doing the thing they log, and
nothing — including this module — edits or deletes a row. A trail that can be amended by
the people it describes is not a trail.

§53 names four Audit Reports; they are `REPORTS` below, and each is a saved set of
actions rather than a separate query, so the auditor's screen is one endpoint.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.audit_modules import MODULES
from app.core.errors import ValidationError
from app.core.timeutil import SCHOOL_TIMEZONE
from app.modules.audit import narrative
from app.modules.audit.schemas import AuditActorRef, AuditFilters, AuditPage
from app.modules.settings.models import AuditLog
from app.modules.users.models import User

#: §53 Audit Reports. The four the blueprint asks for, each a named set of actions.
#:
#: "Transcript issuance" is the fifth in §53 and is deliberately absent — transcripts
#: were deferred with C2, so a report over an action nobody emits would be an empty
#: screen that looks like a bug.
REPORTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "grade_changes": (
        "Grade changes",
        (
            "grade.update",
            "grade.release",
            "grade_revision.request",
            "grade_revision.withdraw",
            "report_card.freeze_midterm",
            "grading_scale.update",
        ),
    ),
    "student_records": (
        "Student record changes",
        (
            "student.create",
            "student.update",
            "student.delete",
            "student.status_change",
            "student.program_change",
            "application.enrolled",
        ),
    ),
    "registration_overrides": (
        "Registration overrides",
        (
            "enrollment.override",
            "offering.enroll",
            "offering.unenroll",
            "offering.enrollment_status",
            "course_prerequisite.add",
            "course_prerequisite.remove",
        ),
    ),
    "system_activity": (
        "System activity",
        (
            "user.create",
            "user.update",
            "user.role_change",
            "user.reset_password",
            "school.update",
            "school.logo_upload_stubbed",
            "assessment_policy.update",
            "academic_year.create",
            "academic_year.archive",
            "semester.create",
            "semester.update",
            "semester.activate",
        ),
    ),
}

#: The migration that added `previous_value` / `new_value`. Rows older than it can have
#: no before/after — the information was never captured — and the screen says so rather
#: than showing an empty change table that reads as "nothing changed".
_PHASE7_MARKER = "020_d45_audit_trail"


def _bounds(from_date: date | None, to_date: date | None):
    """School-local dates -> UTC instants.

    `created_at` is stored in UTC; an auditor asking for "9 September" means the Belize
    day. Comparing their date against a UTC column directly would silently shift the
    boundary by six hours and drop the evening's activity into the wrong day.
    """
    start = end = None
    if from_date:
        start = datetime.combine(from_date, time.min, tzinfo=SCHOOL_TIMEZONE)
    if to_date:
        end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=SCHOOL_TIMEZONE)
    return start, end


def list_audit(
    db: Session,
    *,
    report: str | None = None,
    module: str | None = None,
    action: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    student_id: uuid.UUID | None = None,
    search: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> AuditPage:
    """One page of the trail, newest first, rendered for a person."""
    if report is not None and report not in REPORTS:
        raise ValidationError(
            "Unknown audit report.",
            fields={"report": [f"Choose one of: {', '.join(REPORTS)}."]},
        )

    stmt = select(AuditLog)
    count_stmt = select(func.count()).select_from(AuditLog)

    def both(clause):  # noqa: ANN001, ANN202
        nonlocal stmt, count_stmt
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    if report:
        both(AuditLog.action.in_(REPORTS[report][1]))
    if module:
        both(AuditLog.module == module)
    if action:
        both(AuditLog.action == action)
    if actor_user_id:
        both(AuditLog.actor_user_id == actor_user_id)
    if student_id:
        # The student is in `entity_id` for student-scoped actions and inside `summary`
        # for the ones scoped to an assessment or an offering — a grade change is logged
        # against the assessment, not the student, so `entity_id` alone would miss every
        # grade an auditor asks about by student.
        both(
            (AuditLog.entity_id == student_id)
            | AuditLog.summary.like(f'%"student_id": "{student_id}"%')
        )
    if search:
        like = f"%{search.strip()}%"
        both(AuditLog.summary.like(like) | AuditLog.action.like(like))

    start, end = _bounds(from_date, to_date)
    if start:
        both(AuditLog.created_at >= start)
    if end:
        both(AuditLog.created_at < end)

    total = db.scalar(count_stmt) or 0
    page = max(1, page)
    page_size = min(max(1, page_size), 200)

    rows = db.scalars(
        stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id}
    actors = {
        u.id: (u.full_name or u.email, u.role.value if u.role else None)
        for u in (
            db.scalars(select(User).where(User.id.in_(list(actor_ids)))).all()
            if actor_ids
            else []
        )
    }

    return AuditPage(
        items=narrative.render(db, rows, actors),
        total=total,
        page=page,
        page_size=page_size,
        includes_pre_phase7_rows=any(
            r.previous_value is None and r.new_value is None for r in rows
        ),
    )


def filters(db: Session) -> AuditFilters:
    """What is actually present to filter by — never the full theoretical list.

    Offering a module with no rows behind it sends the auditor to an empty screen and
    leaves them unsure whether they filtered wrongly or nothing ever happened.
    """
    present_modules = [
        m for (m,) in db.execute(
            select(AuditLog.module).distinct().where(AuditLog.module.is_not(None))
        ).all()
    ]
    actor_ids = [
        a for (a,) in db.execute(
            select(AuditLog.actor_user_id).distinct().where(
                AuditLog.actor_user_id.is_not(None)
            )
        ).all()
    ]
    users = (
        db.scalars(select(User).where(User.id.in_(actor_ids))).all() if actor_ids else []
    )
    return AuditFilters(
        modules=[m for m in MODULES if m in set(present_modules)],
        actions=sorted(REPORTS),
        actors=sorted(
            (
                AuditActorRef(
                    id=str(u.id),
                    name=u.full_name or u.email,
                    role=narrative.ROLE_LABELS.get(
                        u.role.value if u.role else "", u.role.value if u.role else None
                    ),
                )
                for u in users
            ),
            key=lambda a: a.name.lower(),
        ),
    )
