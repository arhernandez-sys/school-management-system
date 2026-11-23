"""Announcements router (api-spec §5 Module 9, FR-ANN-*).

Thin transport; the service owns DB + transactions. Mounts under `/api/v1`.

Endpoints:
  GET    /announcements                authenticated -> Page[AnnouncementListItem]
  GET    /announcements/unread-count   authenticated -> {unread_count}
  GET    /announcements/target-offerings authenticated -> {items:[AnnouncementOfferingRef]}
  GET    /announcements/{id}           authenticated -> AnnouncementDetail
  POST   /announcements                P/S/Teacher   -> AnnouncementDetail (201)
  PATCH  /announcements/{id}            author or P   -> AnnouncementDetail
  DELETE /announcements/{id}            author or P   -> 204
  POST   /announcements/{id}/read       authenticated -> 204 (idempotent)

Route order matters here: `/unread-count` and `/target-offerings` are literals that
MUST be declared before `/{announcement_id}`, or the UUID path param would swallow
them and return a 422 on a valid request.

Reads are open to every role — what a caller sees is decided by audience targeting
in the service, not by a role gate.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import AnnouncementAudience, Role
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_current_user, get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.announcements import service
from app.modules.announcements.schemas import (
    AnnouncementCreateRequest,
    AnnouncementDetail,
    AnnouncementListItem,
    AnnouncementUpdateRequest,
    TargetOfferingsResponse,
    UnreadCountResponse,
)
from app.modules.users.models import User

router = APIRouter(prefix="/announcements", tags=["announcements"])

_ERR = {"model": ErrorResponse}
#: D43 — the HOD authors like any lecturer (own offerings). The Auditor never authors.
_authors = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.HOD)


@router.get(
    "",
    response_model=Page[AnnouncementListItem],
    summary="The caller's targeted announcement feed, newest first",
    responses={401: _ERR, 422: _ERR},
)
def list_announcements(
    params: PageParams = Depends(page_params),
    audience: Annotated[AnnouncementAudience | None, Query()] = None,
    unread_only: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> Page[AnnouncementListItem]:
    """Every role may read; targeting decides what comes back. Expired and
    scheduled-for-later notices are excluded."""
    return service.list_announcements(
        db, actor=actor, params=params, audience=audience, unread_only=unread_only
    )


@router.get(
    "/unread-count",
    response_model=UnreadCountResponse,
    summary="Unread count for the notification bell",
    responses={401: _ERR},
)
def unread_count(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> UnreadCountResponse:
    return service.unread_count(db, actor=actor)


@router.get(
    "/target-offerings",
    response_model=TargetOfferingsResponse,
    summary="Sections the caller may target with a class announcement",
    responses={401: _ERR},
)
def target_offerings(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> TargetOfferingsResponse:
    """P/S → all live sections; teacher → only sections they own a subject in;
    student → empty (the compose UI is hidden from them anyway)."""
    return service.target_offerings(db, actor=actor)


@router.get(
    "/{announcement_id}",
    response_model=AnnouncementDetail,
    summary="Full announcement (must target the caller)",
    responses={401: _ERR, 404: _ERR, 422: _ERR},
)
def get_announcement(
    announcement_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> AnnouncementDetail:
    """404 unless the announcement targets the caller — except that an author may
    always read their own and a principal may read anything."""
    return service.get_announcement(db, actor=actor, announcement_id=announcement_id)


@router.post(
    "",
    response_model=AnnouncementDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Post an announcement (P/S any audience; teacher own classes only)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def create_announcement(
    payload: AnnouncementCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_authors),
) -> AnnouncementDetail:
    """403 teacher_cannot_broadcast if a teacher aims anywhere but a section they own.
    422 class_audience_requires_offering_id when a `class` audience names no offering."""
    return service.create_announcement(db, actor=actor, payload=payload)


@router.patch(
    "/{announcement_id}",
    response_model=AnnouncementDetail,
    summary="Edit an announcement (author or principal)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def update_announcement(
    announcement_id: uuid.UUID,
    payload: AnnouncementUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> AnnouncementDetail:
    """Targeting is re-checked against the merged audience, so a teacher cannot turn
    an owned class notice into a school-wide broadcast by editing it."""
    return service.update_announcement(
        db, actor=actor, announcement_id=announcement_id, payload=payload
    )


@router.delete(
    "/{announcement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete an announcement (author or principal)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def delete_announcement(
    announcement_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> Response:
    service.delete_announcement(db, actor=actor, announcement_id=announcement_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{announcement_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark an announcement read (idempotent)",
    responses={401: _ERR, 404: _ERR},
)
def mark_read(
    announcement_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> Response:
    """404 unless it targets the caller — answering 204 would leak that it exists."""
    service.mark_read(db, actor=actor, announcement_id=announcement_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
