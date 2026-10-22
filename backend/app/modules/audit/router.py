"""Audit trail router (D45 §46, §53) — 3 read endpoints, no writes.

  GET /audit                Dean / Auditor  -> AuditPage
  GET /audit/filters        same            -> AuditFilters
  GET /audit/reports        same            -> the §53 report list

WHO CAN READ IT. The Dean (accountable for academic records) and the Auditor (D43 — reads
everything, writes nothing, enforced centrally in `get_current_user`).

**The System Administrator is NOT here, and the attempt to add them is what proved it.**
§2/§48 gave that role accounts, configuration and technical maintenance and explicitly
*not* academic records, and Phase 1 enforced it centrally as `technical_role_scope`. This
router listed `Role.SYSADMIN` on the reasoning that an audit log is administrative — and
the central guard refused it, correctly. **This trail is mostly academic records**: grade
changes with student names and marks, registrations, status changes. Letting a sysadmin
read it would hand them, in one screen, exactly the data §48 spent Phase 1 keeping from
them. The guard was right and the route was wrong.

⚠️ If BAJC wants the sysadmin to see the "System activity" report ONLY (accounts, roles,
configuration — no academic module), that is a real and reasonable request, but it needs a
scoped endpoint that filters BEFORE the academic rows are ever loaded, not a role added to
this gate. Recorded in the plan document as an open question.

**The Registrar is deliberately NOT here.** They are the most frequent subject of the
log — registrations, overrides they escalated, student record edits — and a subject of an
audit trail who can read it is a subject who can see what has been noticed. That is a
decision worth revisiting with BAJC, and it is recorded in the plan document rather than
buried here.

There is no write endpoint and there must never be one. Rows are written as a side effect
of the audited action itself; a trail with an API that can amend it is not evidence.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role
from app.modules.audit import service
from app.modules.audit.schemas import AuditFilters, AuditPage
from app.modules.users.models import User

router = APIRouter(prefix="/audit", tags=["audit"])

_ERR = {"model": ErrorResponse}
_read = require_role(Role.PRINCIPAL, Role.AUDITOR)


@router.get(
    "",
    response_model=AuditPage,
    summary="The audit trail, in plain language (Dean / Auditor; D45 §46)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_audit(
    report: Annotated[str | None, Query()] = None,
    module: Annotated[str | None, Query()] = None,
    action: Annotated[str | None, Query()] = None,
    actor_user_id: Annotated[uuid.UUID | None, Query()] = None,
    student_id: Annotated[uuid.UUID | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=160)] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    db: Session = Depends(get_db),
    _actor: User = Depends(_read),
) -> AuditPage:
    """Newest first. `from_date` / `to_date` are **school-local (America/Belize) dates**
    and both ends are inclusive — an auditor asking for "9 September" means the Belize
    day, and comparing that against the UTC column directly would move the boundary six
    hours and file the evening's activity under the wrong date.

    Every field returned is prose or a name. Ids, table names, action keys and raw JSON
    stay on the server — see `narrative.py`.
    """
    return service.list_audit(
        db,
        report=report,
        module=module,
        action=action,
        actor_user_id=actor_user_id,
        student_id=student_id,
        search=search,
        from_date=from_date,
        to_date=to_date,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/filters",
    response_model=AuditFilters,
    summary="Modules and people actually present in the trail (D45 §53)",
    responses={401: _ERR, 403: _ERR},
)
def audit_filters(
    db: Session = Depends(get_db),
    _actor: User = Depends(_read),
) -> AuditFilters:
    """Only what has rows behind it. A filter that leads to an empty screen leaves the
    auditor unsure whether they filtered wrongly or nothing ever happened."""
    return service.filters(db)


@router.get(
    "/reports",
    summary="The §53 audit reports (Dean / Auditor)",
    responses={401: _ERR, 403: _ERR},
)
def audit_reports(_actor: User = Depends(_read)) -> list[dict]:
    """§53's four named reports. "Transcript issuance" is the fifth in the blueprint and
    is absent on purpose — transcripts deferred with C2, and a report over an action
    nobody emits is an empty screen that looks like a fault."""
    return [
        {"key": key, "name": name, "action_count": len(actions)}
        for key, (name, actions) in service.REPORTS.items()
    ]
