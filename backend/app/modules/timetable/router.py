"""Timetable router (FR-SCH-03..05) — 2 endpoints.

Thin transport; the service owns the queries. Mounts under `/api/v1`.

  GET /timetable/me                    authenticated  -> TimetableView
  GET /timetable/students/{id}         P/S            -> TimetableView

The per-student route is namespaced under `/timetable` rather than added to the
Students module as `/students/{id}/timetable`, so the whole feature is reachable from
one router and one service. Students/Teachers stay unaware of scheduling.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_current_user, get_db, require_role
from app.modules.timetable import service
from app.modules.timetable.schemas import TimetableView
from app.modules.users.models import User

router = APIRouter(prefix="/timetable", tags=["timetable"])

_ERR = {"model": ErrorResponse}
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)
#: D45 §40 — reading ANY student's week.
#:
#: The blueprint lists "Timetable" and "Class lists" among the Head of Department's
#: functions, and D43 established that a head READS everything in the programme(s) they
#: head. This endpoint was `_manage` (Dean + Registrar), so an HOD could not see the week
#: of a student on their own programme — the one gap the D45 §40 reach audit found.
#:
#: A separate gate rather than widening `_manage`, because `_manage` also guards writes
#: elsewhere in this system's routers and this is a READ. The Auditor joins for the same
#: reason they join every other read gate; the central read-only refusal keeps them out of
#: any verb that changes something.
#:
#: The HOD's programme scoping is enforced in the SERVICE, not here — `require_role` is a
#: role allowlist and cannot express "only their own students".
_read_any_student = require_role(
    Role.PRINCIPAL, Role.SECRETARY, Role.HOD, Role.AUDITOR
)
_any = get_current_user


@router.get(
    "/me",
    response_model=TimetableView,
    summary="The caller's own Mon–Fri week (Student = enrolled classes, Teacher = taught classes)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def my_timetable(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> TimetableView:
    return service.my_timetable(db, caller=caller, academic_year_id=academic_year_id)


@router.get(
    "/students/{student_id}",
    response_model=TimetableView,
    summary="Any student's Mon–Fri week (P/S/Auditor; HOD scoped to own programmes)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def student_timetable(
    student_id: uuid.UUID,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_read_any_student),
) -> TimetableView:
    return service.student_timetable(
        db, actor=actor, student_id=student_id, academic_year_id=academic_year_id
    )
