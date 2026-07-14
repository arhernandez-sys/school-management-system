"""Teachers router (api-spec §5 Module 4) — the 6 teacher endpoints.

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

Endpoints:
  GET    /teachers                 P/S/Teacher(RO)  -> Page[TeacherListItem]
  GET    /teachers/{id}            P/S/Teacher(RO)  -> TeacherDetail
  POST   /teachers                 P/S              -> TeacherCreateResponse (201)
  PATCH  /teachers/{id}             P/S              -> TeacherDetail
  POST   /teachers/{id}/status      Principal        -> TeacherDetail
  DELETE /teachers/{id}             Principal        -> 204

Student is denied on every teacher route at the role gate (403, api-spec §3.4).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import Role, TeacherStatus
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.teachers import service
from app.modules.teachers.schemas import (
    TeacherCreateRequest,
    TeacherCreateResponse,
    TeacherDetail,
    TeacherListItem,
    TeacherStatusRequest,
    TeacherUpdateRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/teachers", tags=["teachers"])

_ERR = {"model": ErrorResponse}
_read = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER)
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)
_principal_only = require_role(Role.PRINCIPAL)


@router.get(
    "",
    response_model=Page[TeacherListItem],
    summary="Teacher directory (P/S/Teacher RO; api-spec §5.4, FR-TCH-05)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_teachers(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=160)] = None,
    status_filter: Annotated[TeacherStatus | None, Query(alias="status")] = None,
    specialization: Annotated[str | None, Query(max_length=120)] = None,
    db: Session = Depends(get_db),
    _caller: User = Depends(_read),
) -> Page[TeacherListItem]:
    """Read-only for teachers; students are denied at the gate (403)."""
    return service.list_teachers(
        db,
        params=params,
        search=search,
        status=status_filter,
        specialization=specialization,
    )


@router.get(
    "/{teacher_id}",
    response_model=TeacherDetail,
    summary="Teacher detail (P/S/Teacher RO; api-spec §5.4)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_teacher(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    _caller: User = Depends(_read),
) -> TeacherDetail:
    return service.get_teacher(db, teacher_id=teacher_id)


@router.post(
    "",
    response_model=TeacherCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a teacher (P/S; api-spec §5.4, FR-TCH-01)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_teacher(
    payload: TeacherCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> TeacherCreateResponse:
    """409 duplicate_staff_number / duplicate_email. `create_login` provisions a
    linked teacher account; its temp password is returned ONCE."""
    detail, temp_password = service.create_teacher(db, actor=actor, payload=payload)
    return TeacherCreateResponse(teacher=detail, temporary_password=temp_password)


@router.patch(
    "/{teacher_id}",
    response_model=TeacherDetail,
    summary="Update a teacher's profile (P/S; api-spec §5.4, FR-TCH-03)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_teacher(
    teacher_id: uuid.UUID,
    payload: TeacherUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> TeacherDetail:
    """Benign profile edits only. Deactivation = POST /teachers/{id}/status
    (Principal-only)."""
    return service.update_teacher(
        db, actor=actor, teacher_id=teacher_id, payload=payload
    )


@router.post(
    "/{teacher_id}/status",
    response_model=TeacherDetail,
    summary="Activate/deactivate a teacher (Principal; api-spec §5.4, FR-TCH-03)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def change_teacher_status(
    teacher_id: uuid.UUID,
    payload: TeacherStatusRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_only),
) -> TeacherDetail:
    """Deactivating a teacher with active class_subject assignments is blocked →
    409 teacher_has_active_assignments (with offending refs, FR-TCH-06)."""
    return service.change_teacher_status(
        db, actor=actor, teacher_id=teacher_id, payload=payload
    )


@router.delete(
    "/{teacher_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a teacher if unassigned (Principal; §5.4, FR-TCH-03/06)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_teacher(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_only),
) -> Response:
    """Blocked if assigned to any active class_subject (FK RESTRICT) → 409
    teacher_has_active_assignments."""
    service.delete_teacher(db, actor=actor, teacher_id=teacher_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
