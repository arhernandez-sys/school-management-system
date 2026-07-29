"""Release-nudge primitives: the "awaiting release" predicate + its audit trail.

Two consumers must agree on exactly one question — *does this assessment hold work
that is marked but still hidden from students?*

  * the teacher dashboard, which counts and lists those assessments
    (`dashboard/service.py::_teacher_payload`);
  * `POST /assessments/{id}/nudge-release`, which refuses to remind a teacher about
    an assessment that has nothing awaiting release
    (`assessments/service.py::nudge_release`).

They share `graded_unreleased_clause()` so the tile and the 409 can never disagree.

This module lives beside the assessments models rather than inside
`assessments/service.py` because `dashboard/service.py` and `grades/service.py`
both need it; importing only models keeps it free of any service-layer import
cycle.

**Storage.** There is no notifications table and no new column — a nudge IS an
`audit_log` row (schema §7, the same append-only table the ~45 existing `_audit()`
call sites write to). "Last reminded at" is therefore derived by reading the most
recent such row back, not stored anywhere else. That is deliberate: Alembic is
Postgres-only and non-functional against this MariaDB instance, so a schema change
would mean hand-run DDL for a feature that needs no new shape.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.common.enums import GradeStatus
from app.core.timeutil import ensure_aware, utcnow
from app.modules.assessments.models import Assessment
from app.modules.grades.models import AssessmentGrade
from app.modules.settings.models import AuditLog
from app.modules.users.models import User

#: `audit_log.action` for a nudge. Namespaced under `grade.` alongside the
#: existing `grade.release` / `grade.unrelease` rows written by `set_release`,
#: because a nudge is a step in the same release workflow.
NUDGE_ACTION = "grade.release_nudge"

#: `audit_log.entity_type`. The nudge is keyed to the ASSESSMENT (the unit a
#: teacher releases), matching how `assessments/service.py::_audit` types its rows.
NUDGE_ENTITY_TYPE = "assessment"

#: How long a principal/secretary must wait before nudging the same assessment again.
#:
#: Four hours is chosen against the school day rather than an arbitrary round
#: number. It is long enough that a principal cannot re-send during a single
#: working session (the behaviour that turns a reminder into nagging, and the whole
#: reason this is rate-limited at all), yet short enough that a genuine escalation
#: — "still not released after the morning block" — is possible on the SAME day
#: rather than forcing the follow-up to tomorrow. It also comfortably exceeds the
#: realistic time-to-act, so a teacher who is mid-release is never nudged twice for
#: work they are already doing.
NUDGE_COOLDOWN = timedelta(hours=4)
NUDGE_COOLDOWN_SECONDS = int(NUDGE_COOLDOWN.total_seconds())


def graded_unreleased_clause():
    """SQL predicate: this `assessment_grades` row is MARKED but still HIDDEN.

    Must be used on a statement that joins `assessments` to `assessment_grades`,
    because the effective release flag spans both tables.

    Two halves, mirroring the read rule used everywhere else in this codebase
    (`grade.is_released ?? assessment.is_released`):

      * the grade row was explicitly unreleased for this student, or
      * the grade row defers (NULL) and the whole column is unreleased.

    `status == GRADED` — not merely "a row exists" — is what makes this *awaiting
    release* rather than *awaiting marking*. A `pending` row is unmarked work and
    belongs to `ungraded_items`; an `absent`/`excused`/`exempt` row carries no score
    to reveal, so releasing it changes nothing a student would see.
    """
    return and_(
        AssessmentGrade.status == GradeStatus.GRADED,
        or_(
            AssessmentGrade.is_released.is_(False),
            and_(
                AssessmentGrade.is_released.is_(None),
                Assessment.is_released.is_(False),
            ),
        ),
    )


def count_awaiting_release(db: Session, assessment_id: uuid.UUID) -> int:
    """How many of one assessment's grades are marked but still hidden."""
    return (
        db.scalar(
            select(func.count())
            .select_from(AssessmentGrade)
            .join(Assessment, AssessmentGrade.assessment_id == Assessment.id)
            .where(
                AssessmentGrade.assessment_id == assessment_id,
                graded_unreleased_clause(),
            )
        )
        or 0
    )


def record_nudge(
    db: Session,
    *,
    actor: User,
    assessment_id: uuid.UUID,
    summary: dict | None = None,
) -> datetime:
    """Append the nudge to `audit_log` and return its (UTC, aware) timestamp.

    Does NOT commit — the caller owns the transaction, exactly as every other
    `_audit()` call site does.

    `created_at` is set EXPLICITLY rather than left to the column's
    `server_default=now()`. Every other audit row is written for humans to read
    later, so server-clock time is harmless there; this one is read back to make a
    *decision* (the cooldown), and MariaDB's `now()` returns the session timezone,
    which is not guaranteed to be UTC. Passing `utcnow()` keeps the stored value
    unambiguously UTC and comparable to the `utcnow()` the cooldown check uses.
    """
    at = utcnow()
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=NUDGE_ACTION,
            entity_type=NUDGE_ENTITY_TYPE,
            entity_id=assessment_id,
            summary=summary,
            created_at=at,
        )
    )
    return at


def last_nudged_at_bulk(
    db: Session, assessment_ids: list[uuid.UUID]
) -> dict[uuid.UUID, datetime]:
    """Most recent nudge per assessment — ONE grouped query, never one per row.

    Values are passed through `ensure_aware()`: pymysql hands back naive datetimes,
    and comparing one to an aware `utcnow()` raises TypeError.
    """
    if not assessment_ids:
        return {}
    rows = db.execute(
        select(AuditLog.entity_id, func.max(AuditLog.created_at))
        .where(
            AuditLog.action == NUDGE_ACTION,
            AuditLog.entity_type == NUDGE_ENTITY_TYPE,
            AuditLog.entity_id.in_(assessment_ids),
        )
        .group_by(AuditLog.entity_id)
    ).all()
    out: dict[uuid.UUID, datetime] = {}
    for entity_id, at in rows:
        aware = ensure_aware(at)
        if entity_id is not None and aware is not None:
            out[entity_id] = aware
    return out


def last_nudged_at(db: Session, assessment_id: uuid.UUID) -> datetime | None:
    """Single-assessment form of `last_nudged_at_bulk`."""
    return last_nudged_at_bulk(db, [assessment_id]).get(assessment_id)
