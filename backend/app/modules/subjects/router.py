"""Subjects catalog router (api-spec §5 Module 5b) — the 4 catalog endpoints.

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

Endpoints:
  GET    /subjects          authenticated  -> Page[SubjectListItem]
  POST   /subjects          P/S            -> SubjectDetail (201)
  PATCH  /subjects/{id}      P/S            -> SubjectDetail
  DELETE /subjects/{id}      P/S            -> 204
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
from app.modules.subjects import service
from app.modules.subjects.schemas import (
    SubjectCreateRequest,
    SubjectDetail,
    SubjectListItem,
    SubjectUpdateRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/subjects", tags=["subjects"])

_ERR = {"model": ErrorResponse}
_principal_or_secretary = require_role(Role.PRINCIPAL, Role.SECRETARY)


@router.get(
    "",
    response_model=Page[SubjectListItem],
    summary="The subject catalog / picker (authenticated; api-spec §5b)",
    responses={401: _ERR, 422: _ERR},
)
def list_subjects(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=120)] = None,
    is_active: Annotated[bool | None, Query()] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[SubjectListItem]:
    """Everyone may read the catalog (reference data, no PII). Default is_active
    filter hides retired subjects from the picker."""
    return service.list_subjects(
        db, params=params, search=search, is_active=is_active
    )


@router.post(
    "",
    response_model=SubjectDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a subject (P/S; api-spec §5b, FR-CLS-01a)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_subject(
    payload: SubjectCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> SubjectDetail:
    """409 duplicate_subject_name / duplicate_subject_code."""
    return service.create_subject(db, actor=actor, payload=payload)


@router.patch(
    "/{subject_id}",
    response_model=SubjectDetail,
    summary="Update a subject (P/S; api-spec §5b)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_subject(
    subject_id: uuid.UUID,
    payload: SubjectUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> SubjectDetail:
    """Edits name/code/is_active. Renaming is safe for history (frozen subject_id)."""
    return service.update_subject(
        db, actor=actor, subject_id=subject_id, payload=payload
    )


@router.delete(
    "/{subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a subject if unused (P/S; api-spec §5b)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_subject(
    subject_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> Response:
    """Soft-delete only if no class_subjects offering references it; else 409
    subject_in_use (retire via PATCH is_active=false instead)."""
    service.delete_subject(db, actor=actor, subject_id=subject_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
