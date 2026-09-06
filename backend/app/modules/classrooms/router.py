"""Classrooms router (D44).

Thin transport; the service owns DB + transactions. Mounts under `/api/v1`.

**PERMISSIONS.** Reading is open to every authenticated user — a room code is on every
timetable and there is nothing private about "A-101 is in the Main Block". Writing is
Dean + Registrar: rooms are estate administration, the same pair that owns offerings and
scheduling, and unlike the course catalogue this is not an academic decision the Dean
holds alone.

The Auditor is not listed on the write dependency and would be refused centrally anyway
(`get_current_user`); it is on the read one because it reads everything.

Endpoints:
  GET    /classrooms         authenticated  -> Page[ClassroomListItem]
  GET    /classrooms/{id}    authenticated  -> ClassroomDetail
  POST   /classrooms         P/S            -> ClassroomDetail (201)
  PATCH  /classrooms/{id}    P/S            -> ClassroomDetail
  DELETE /classrooms/{id}    P/S            -> 204 (HARD; refused while in use)
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import ClassroomStatus, Role
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_current_user, get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.classrooms import service
from app.modules.classrooms.schemas import (
    ClassroomDetail,
    ClassroomListItem,
    ClassroomWriteRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/classrooms", tags=["classrooms"])

_ERR = {"model": ErrorResponse}
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)


@router.get(
    "",
    response_model=Page[ClassroomListItem],
    summary="The college's rooms (authenticated)",
    responses={401: _ERR, 422: _ERR},
)
def list_classrooms(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=120)] = None,
    status_filter: Annotated[ClassroomStatus | None, Query(alias="status")] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[ClassroomListItem]:
    """Ordered building then room code — how a person actually looks for a room.
    `search` matches the code, the building or the room type."""
    return service.list_classrooms(
        db, params=params, search=search, status=status_filter
    )


@router.get(
    "/{room_id}",
    response_model=ClassroomDetail,
    summary="One room (authenticated)",
    responses={401: _ERR, 404: _ERR, 422: _ERR},
)
def get_classroom(
    room_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ClassroomDetail:
    return service.get_classroom(db, room_id=room_id)


@router.post(
    "",
    response_model=ClassroomDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Add a room (Dean + Registrar)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_classroom(
    payload: ClassroomWriteRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> ClassroomDetail:
    """`room_code` and `building` are required; the rest may arrive later.

    `status` accepts Active or Inactive only — see `ClassroomWriteRequest`."""
    return service.create_classroom(db, actor=actor, payload=payload)


@router.patch(
    "/{room_id}",
    response_model=ClassroomDetail,
    summary="Edit a room (Dean + Registrar)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_classroom(
    room_id: uuid.UUID,
    payload: ClassroomWriteRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> ClassroomDetail:
    """Applies only the keys PRESENT, so a partial save cannot blank what it omits."""
    return service.update_classroom(
        db, actor=actor, room_id=room_id, payload=payload
    )


@router.delete(
    "/{room_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a room (Dean + Registrar)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def delete_classroom(
    room_id: uuid.UUID,
    db: Session = Depends(get_db),
    _actor: User = Depends(_manage),
) -> Response:
    """HARD delete — a room carries no history worth keeping. Refused with 409
    `classroom_in_use` while any live offering is scheduled there, rather than silently
    unrooming them through the `ON DELETE SET NULL`."""
    service.delete_classroom(db, room_id=room_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
