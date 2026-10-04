"""Calendar events router (Module 12 — scope addition, 2026-07).

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

Endpoints:
  GET    /events            authenticated  -> EventListResponse (visibility-scoped)
  POST   /events            P/S            -> EventView (201)
  PATCH  /events/{id}        P/S            -> EventView
  DELETE /events/{id}        P/S            -> 204

Reads are open to every role because the calendar is school-wide; the `internal`
visibility flag (not the role gate) is what hides staff events from students, and
the service applies it. Writes are principal/secretary — teachers read the shared
calendar but do not own it.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_current_user, get_db, require_role
from app.modules.events import service
from app.modules.events.schemas import (
    EventCreateRequest,
    EventListResponse,
    EventUpdateRequest,
    EventView,
)
from app.modules.users.models import User

router = APIRouter(prefix="/events", tags=["events"])

_ERR = {"model": ErrorResponse}
_principal_or_secretary = require_role(Role.PRINCIPAL, Role.SECRETARY)


@router.get(
    "",
    response_model=EventListResponse,
    summary="The school calendar feed (all roles; students see `global` only)",
    responses={401: _ERR, 422: _ERR},
)
def list_events(
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
) -> EventListResponse:
    """`from`/`to` are optional and select events whose span OVERLAPS the window.
    The frontend currently fetches the whole feed and filters client-side."""
    return service.list_events(db, viewer=viewer, date_from=date_from, date_to=date_to)


@router.post(
    "",
    response_model=EventView,
    status_code=status.HTTP_201_CREATED,
    summary="Add a calendar event (P/S)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def create_event(
    payload: EventCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> EventView:
    """422 validation_error on end-before-start or a timed event with no start time."""
    return service.create_event(db, actor=actor, payload=payload)


@router.patch(
    "/{event_id}",
    response_model=EventView,
    summary="Edit a calendar event (P/S)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def update_event(
    event_id: uuid.UUID,
    payload: EventUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> EventView:
    """Partial update. Cross-field rules are re-checked against the merged state."""
    return service.update_event(db, actor=actor, event_id=event_id, payload=payload)


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a calendar event (P/S)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def delete_event(
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> Response:
    """Hard delete — the `events` table has no soft-delete column."""
    service.delete_event(db, actor=actor, event_id=event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
