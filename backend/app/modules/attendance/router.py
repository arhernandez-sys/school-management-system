"""Attendance router (api-spec §5 Module 8, FR-ATT-*, D-Q4).

Thin transport; the service owns DB + transactions. Mounts under `/api/v1`.

Endpoints:
  GET /attendance/offerings  T/P/S     -> AttendanceOfferingsResponse
  GET /attendance            T/P/S     -> AttendanceRegister    (offering_id REQUIRED)
  PUT /attendance            Teacher   -> AttendanceUpsertResponse
  GET /attendance/summary    T/P/S     -> AttendanceSummaryResponse
  GET /attendance/me         Student   -> MyAttendanceResponse

Paths follow the finished frontend (`?offering_id=`), NOT api-spec §8's original
`/attendance/class/{class_id}` shape — see the api-spec reconciliation note.

Route order: the literal `/offerings`, `/summary` and `/me` are declared before the
bare `/attendance` handlers, though no path param makes them ambiguous.

Recording is teacher-only: P/S read the register and the summary but do not mark it.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role, require_role_within_access_window
from app.modules.attendance import service
from app.modules.attendance.schemas import (
    AttendanceRegister,
    AttendanceOfferingsResponse,
    AttendanceSummaryResponse,
    AttendanceUpsertRequest,
    AttendanceUpsertResponse,
    MyAttendanceResponse,
)
from app.modules.users.models import User

router = APIRouter(prefix="/attendance", tags=["attendance"])

_ERR = {"model": ErrorResponse}
_staff = require_role(
    Role.TEACHER, Role.PRINCIPAL, Role.SECRETARY, Role.HOD, Role.AUDITOR
)
#: D43 — the HOD is a lecturer and records attendance for the offerings they teach.
#: OWNERSHIP, not this tuple, is what stops them touching a colleague's register.
_teacher = require_role(Role.TEACHER, Role.HOD)
# D39 (Meeting #2 item 6) — a graduated student past the school's post-graduation window
# loses access to their attendance record along with their grades.
_student = require_role_within_access_window(Role.STUDENT)


@router.get(
    "/offerings",
    response_model=AttendanceOfferingsResponse,
    summary="Offerings the caller may view or mark",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_offerings(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> AttendanceOfferingsResponse:
    """Teacher → the offerings they are assigned to; P/S → all offerings of the
    year. `can_record` is true only for a teacher."""
    return service.list_offerings(db, actor=actor, academic_year_id=academic_year_id)


@router.get(
    "/summary",
    response_model=AttendanceSummaryResponse,
    summary="Attendance rates for an offering (overall, per day, per student)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_summary(
    offering_id: Annotated[uuid.UUID, Query()],
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> AttendanceSummaryResponse:
    """`by_student` spans the full active roster, so a student with no records
    still appears as a zero row."""
    return service.get_summary(
        db, actor=actor, offering_id=offering_id, date_from=date_from, date_to=date_to
    )


@router.get(
    "/me",
    response_model=MyAttendanceResponse,
    summary="The signed-in student's own attendance history",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_my_attendance(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_student),
) -> MyAttendanceResponse:
    """Student-only, self-scoped. History is newest-first.

    `semester_id` narrows within the selected year; omitted, the history spans the
    whole year exactly as before."""
    return service.get_my_attendance(
        db, actor=actor, academic_year_id=academic_year_id, semester_id=semester_id
    )


@router.get(
    "",
    response_model=AttendanceRegister,
    summary="The daily register for one (offering, date)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_register(
    offering_id: Annotated[uuid.UUID, Query()],
    on_date: Annotated[date | None, Query(alias="date")] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> AttendanceRegister:
    """`offering_id` is required — omitting it is a 422. `date` defaults to today.
    An unmarked student has `status: null`, which is not an attendance value."""
    return service.get_register(db, actor=actor, offering_id=offering_id, on_date=on_date)


@router.put(
    "",
    response_model=AttendanceUpsertResponse,
    summary="Mark the register for one (offering, date) (teacher)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def upsert_register(
    payload: AttendanceUpsertRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> AttendanceUpsertResponse:
    """Teacher-only (403 for P/S) + offering ownership (404). Rejects future dates
    (422 future_date_not_allowed), archived years (409) and non-roster students
    (422 student_not_enrolled). Upsert key is (offering, student, date)."""
    return service.upsert_register(db, actor=actor, payload=payload)
