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
    summary="Any student's Mon–Fri week (P/S; FR-SCH-05)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def student_timetable(
    student_id: uuid.UUID,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> TimetableView:
    return service.student_timetable(
        db, student_id=student_id, academic_year_id=academic_year_id
    )
