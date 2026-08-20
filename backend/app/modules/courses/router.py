"""Subjects catalog router (api-spec §5 Module 5b) — the 4 catalog endpoints.

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

D30 — THE COURSE CATALOG IS DEAN-ONLY TO WRITE.
The catalog holds BAJC's courses (a course code, name and, from 005, credits
and component). The brief is explicit: "Only the Dean should have permission to create,
edit, or delete academic courses. Do not allow the Registrar or Lecturer to create
courses." So the three write endpoints moved from P/S to **principal only** (the Dean).

Reading stays open to every authenticated user — it is reference data with no PII, and
the picker on the offerings screen needs it. Scheduling an OFFERING of a course
(`/classes`) remains Registrar work; only the catalog itself is reserved.

Endpoints:
  GET    /courses          authenticated  -> Page[CourseListItem]
  POST   /courses          Dean (P)       -> CourseDetail (201)
  PATCH  /courses/{id}      Dean (P)       -> CourseDetail
  DELETE /courses/{id}      Dean (P)       -> 204
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_current_user, get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.courses import service
from app.modules.courses.schemas import (
    CourseCreateRequest,
    CourseDetail,
    CourseListItem,
    CourseUpdateRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/courses", tags=["courses"])

_ERR = {"model": ErrorResponse}
# D30: the Dean alone owns the course catalog (brief §6). Was P/S.
_dean_only = require_role(Role.PRINCIPAL)


@router.get(
    "",
    response_model=Page[CourseListItem],
    summary="The course catalog / picker (authenticated; api-spec §5b)",
    responses={401: _ERR, 422: _ERR},
)
def list_courses(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=120)] = None,
    is_active: Annotated[bool | None, Query()] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[CourseListItem]:
    """Everyone may read the catalog (reference data, no PII). Default is_active
    filter hides retired courses from the picker."""
    return service.list_courses(
        db, params=params, search=search, is_active=is_active
    )


@router.post(
    "",
    response_model=CourseDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a course in the catalog (Dean only; api-spec §5b, FR-CLS-01a)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_course(
    payload: CourseCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> CourseDetail:
    """409 duplicate_course_name / duplicate_course_code."""
    return service.create_course(db, actor=actor, payload=payload)


@router.patch(
    "/{course_id}",
    response_model=CourseDetail,
    summary="Update a course in the catalog (Dean only; api-spec §5b)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> CourseDetail:
    """Edits name/code/is_active. Renaming is safe for history (frozen course_id)."""
    return service.update_course(
        db, actor=actor, course_id=course_id, payload=payload
    )


@router.delete(
    "/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a course if unused (Dean only; api-spec §5b)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_course(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> Response:
    """Soft-delete only if no offering references it; else 409
    course_in_use (retire via PATCH is_active=false instead)."""
    service.delete_course(db, actor=actor, course_id=course_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
