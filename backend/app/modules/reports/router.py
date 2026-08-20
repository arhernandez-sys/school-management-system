"""Reports router (api-spec §5 Module 10, FR-RPT-*, FR-TRN-*).

Thin transport; the service owns DB access. Mounts under `/api/v1`.

Endpoints:
  GET /reports/students          P/S/Teacher -> StudentPickerPage
  GET /reports/report-card       P/S/Teacher -> ReportCard        (?student_id=&semester_id=)
  GET /reports/report-card/me    Student     -> ReportCard        (?semester_id=)
  GET /reports/transcript        P/S ONLY    -> Transcript        (?student_id=)  [D26]
  GET /reports/offering-grades   P/S/Teacher -> OfferingGradesReport (?offering_id=)
  GET /reports/attendance        P/S/Teacher -> AttendanceReport  (?section_id=)
  GET /reports/enrollment        P/S ONLY    -> EnrollmentReport

Paths follow the finished frontend's QUERY-PARAM form, not api-spec §5.10's original
path-param form (`/reports/report-card/{student_id}`) — see the api-spec reconciliation
note. Route order matters: `/report-card/me` is declared BEFORE `/report-card` would
matter if the latter took a path param; it doesn't, but the literal stays first for
clarity.

The last three have no frontend caller today; they are built per the api-spec and are
thin shells over the same helpers the real screens use.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.reports import service
from app.modules.reports.schemas import (
    AttendanceReport,
    OfferingGradesReport,
    EnrollmentReport,
    ReportCard,
    StudentPickerPage,
    Transcript,
)
from app.modules.users.models import User

router = APIRouter(prefix="/reports", tags=["reports"])

_ERR = {"model": ErrorResponse}
_staff = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER)
_admins = require_role(Role.PRINCIPAL, Role.SECRETARY)
_student = require_role(Role.STUDENT)


@router.get(
    "/students",
    response_model=StudentPickerPage,
    summary="Student picker for the report screens",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_students(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=120)] = None,
    status: Annotated[str | None, Query()] = None,
    db: Session = Depends(get_db),
    _actor: User = Depends(_staff),
) -> StudentPickerPage:
    return service.list_students(db, params=params, search=search, status=status)


@router.get(
    "/report-card/me",
    response_model=ReportCard,
    summary="The signed-in student's own report card",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_my_report_card(
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_student),
) -> ReportCard:
    """A subject with any unreleased graded work shows as `status="pending"` with no
    numeric (AC 5.5) — an official document must not print a partial average."""
    return service.get_my_report_card(db, actor=actor, semester_id=semester_id)


@router.get(
    "/report-card",
    response_model=ReportCard,
    summary="A student's report card (P/S/Teacher)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_report_card(
    student_id: Annotated[uuid.UUID, Query()],
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> ReportCard:
    """404 `semester_not_found` for an unknown `semester_id` — no silent fallback to
    the active term, which would mask a client bug."""
    return service.get_report_card(
        db, actor=actor, student_id=student_id, semester_id=semester_id
    )


@router.get(
    "/transcript",
    response_model=Transcript,
    summary="A student's multi-year transcript (principal/secretary only — D26)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_transcript(
    student_id: Annotated[uuid.UUID, Query()],
    db: Session = Depends(get_db),
    actor: User = Depends(_admins),
) -> Transcript:
    """Archived years read frozen snapshots; the live year computes on read (§10.6)."""
    return service.get_transcript(db, actor=actor, student_id=student_id)


@router.get(
    "/offering-grades",
    response_model=OfferingGradesReport,
    summary="Per-offering grade summary + letter distribution",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_offering_grades(
    offering_id: Annotated[uuid.UUID, Query()],
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> OfferingGradesReport:
    """No frontend caller today — FR-RPT-02 is served by the real gradebook."""
    return service.get_offering_grades(
        db, actor=actor, offering_id=offering_id, semester_id=semester_id
    )


@router.get(
    "/attendance",
    response_model=AttendanceReport,
    response_model_by_alias=True,
    summary="Per-section attendance summary",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_attendance_report(
    section_id: Annotated[uuid.UUID, Query()],
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> AttendanceReport:
    """No frontend caller today — FR-RPT-03 is served by `/attendance/summary`.
    Serialized by alias so the section key is emitted as `class`, matching the mock."""
    return service.get_attendance_report(db, actor=actor, section_id=section_id)


@router.get(
    "/enrollment",
    response_model=EnrollmentReport,
    summary="Headcount by grade and section (principal/secretary only)",
    responses={401: _ERR, 403: _ERR},
)
def get_enrollment_report(
    db: Session = Depends(get_db),
    actor: User = Depends(_admins),
) -> EnrollmentReport:
    """No frontend caller today — FR-RPT-04 is served by the principal dashboard."""
    return service.get_enrollment_report(db, actor=actor)
