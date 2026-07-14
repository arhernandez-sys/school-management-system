"""Students router (api-spec §5 Module 3) — the 8 student endpoints.

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

Endpoints:
  GET    /students                      P/S/Teacher   -> Page[StudentListItem]
  GET    /students/me                   Student       -> StudentDetail
  GET    /students/{id}                 P/S/Teacher   -> StudentDetail
  GET    /students/{id}/assessments     P/S/Teacher   -> StudentAssessmentItem[]
  POST   /students                      P/S           -> StudentDetail (201)
  PATCH  /students/{id}                  P/S           -> StudentDetail
  POST   /students/{id}/status           P/S           -> StudentDetail
  DELETE /students/{id}                  P/S           -> 204

Route ordering note: `/students/me` is declared BEFORE `/students/{student_id}`
so the literal path wins over the UUID path param (a student hitting /me must not
be parsed as an id).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import Role, StudentStatus
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.students import service
from app.modules.students.schemas import (
    StudentAssessmentItem,
    StudentCreateRequest,
    StudentDetail,
    StudentListItem,
    StudentStatusRequest,
    StudentUpdateRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/students", tags=["students"])

_ERR = {"model": ErrorResponse}
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)
_read = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER)
_student_only = require_role(Role.STUDENT)


@router.get(
    "",
    response_model=Page[StudentListItem],
    summary="List students (P/S/Teacher; api-spec §5.3, FR-STU-06)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_students(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=160)] = None,
    status_filter: Annotated[StudentStatus | None, Query(alias="status")] = None,
    class_id: Annotated[uuid.UUID | None, Query()] = None,
    grade_level: Annotated[str | None, Query(max_length=40)] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> Page[StudentListItem]:
    """Teacher results auto-restrict to students in a section they own any subject
    of (FR-STU-08). Students are denied at the role gate (403)."""
    return service.list_students(
        db,
        caller=caller,
        params=params,
        search=search,
        status=status_filter,
        class_id=class_id,
        grade_level=grade_level,
    )


@router.get(
    "/me",
    response_model=StudentDetail,
    summary="The signed-in student's own profile (student; api-spec §5.3, FR-STU-09)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_my_student(
    db: Session = Depends(get_db),
    caller: User = Depends(_student_only),
) -> StudentDetail:
    """Server-derived scope: the profile is resolved from the token, never a param
    (§3.2). 404 no_student_profile if the login isn't linked to a student."""
    return service.get_my_student(db, caller=caller)


@router.get(
    "/{student_id}",
    response_model=StudentDetail,
    summary="Student detail (P/S/Teacher; api-spec §5.3, FR-STU-07)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_student(
    student_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> StudentDetail:
    """Teacher must own a section the student is enrolled in, else 404 (§3.3).
    Students are denied at the role gate (403 → use /students/me)."""
    return service.get_student(db, caller=caller, student_id=student_id)


@router.get(
    "/{student_id}/assessments",
    response_model=list[StudentAssessmentItem],
    summary="Assessments for the student's section subjects (P/S/Teacher; §5.3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def list_student_assessments(
    student_id: uuid.UUID,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> list[StudentAssessmentItem]:
    """Teacher must own a section the student is in, else 404. (A student self uses
    GET /assessments?scope=me in the Assessments module.)"""
    return service.list_student_assessments(
        db, caller=caller, student_id=student_id, semester_id=semester_id
    )


@router.post(
    "",
    response_model=StudentDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a student (P/S; api-spec §5.3, FR-STU-01/02/05)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def create_student(
    payload: StudentCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> StudentDetail:
    """Optionally enrolls into `section_id` for the active semester in one txn.
    409 duplicate_student_number / section_archived / no_active_semester."""
    return service.create_student(db, actor=actor, payload=payload)


@router.patch(
    "/{student_id}",
    response_model=StudentDetail,
    summary="Update a student's profile (P/S; api-spec §5.3, FR-STU-03)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_student(
    student_id: uuid.UUID,
    payload: StudentUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> StudentDetail:
    """`status` is NOT editable here — use POST /students/{id}/status. Re-checks
    student_number uniqueness on change."""
    return service.update_student(
        db, actor=actor, student_id=student_id, payload=payload
    )


@router.post(
    "/{student_id}/status",
    response_model=StudentDetail,
    summary="Change a student's lifecycle status (P/S; api-spec §5.3, FR-STU-04)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def change_student_status(
    student_id: uuid.UUID,
    payload: StudentStatusRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> StudentDetail:
    """Auditable, guarded lifecycle change. 422 invalid_transition on an illegal
    move (FR-STU-04)."""
    return service.change_student_status(
        db, actor=actor, student_id=student_id, payload=payload
    )


@router.delete(
    "/{student_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a student if no academic history (P/S; §5.3, FR-STU-10)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_student(
    student_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    """Blocked if any grade/attendance references the student (FK RESTRICT) → 409
    has_academic_history (deactivate instead)."""
    service.delete_student(db, actor=actor, student_id=student_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
