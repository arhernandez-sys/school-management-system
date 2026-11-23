"""Classroom service (D44). Owns the DB session and the transaction boundary."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import SETTABLE_CLASSROOM_STATUSES, ClassroomStatus
from app.common.schemas import Page
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.timeutil import utcnow
from app.modules.classrooms.models import Classroom
from app.modules.classrooms.schemas import (
    ClassroomDetail,
    ClassroomListItem,
    ClassroomWriteRequest,
)
from app.modules.offerings.models import CourseOffering
from app.modules.users.models import User


def _offering_counts(db: Session, room_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Live offerings per room, in ONE query. A per-row count would be an N+1 across a
    page of rooms to answer a question one GROUP BY settles."""
    if not room_ids:
        return {}
    rows = db.execute(
        select(CourseOffering.classroomid, func.count())
        .where(
            CourseOffering.classroomid.in_(room_ids),
            CourseOffering.deleted_at.is_(None),
        )
        .group_by(CourseOffering.classroomid)
    ).all()
    return {room_id: count for room_id, count in rows}


def _item(room: Classroom, *, offering_count: int = 0) -> ClassroomListItem:
    return ClassroomListItem(
        id=room.classroomid,
        room_code=room.roomcode,
        building=room.building,
        capacity=room.capacity,
        room_type=room.room_type,
        status=room.status,
        label=room.label,
        offering_count=offering_count,
    )


def _detail(db: Session, room: Classroom) -> ClassroomDetail:
    counts = _offering_counts(db, [room.classroomid])
    return ClassroomDetail(
        **_item(room, offering_count=counts.get(room.classroomid, 0)).model_dump(),
        created_on=room.created_on,
        edited_on=room.edited_on,
    )


def _room_or_404(db: Session, room_id: uuid.UUID) -> Classroom:
    room = db.get(Classroom, room_id)
    if room is None:
        raise NotFound("Classroom not found.", code="not_found")
    return room


def _assert_settable(status: ClassroomStatus | None) -> None:
    """Refuse the three occupancy values on a WRITE.

    The column accepts them so the client's own data loads; the API does not offer them,
    because `In-Use` typed into a form on Monday is wrong by Monday afternoon and the
    timetable already knows the truth. Refusing loudly beats accepting a value nothing
    will ever update.
    """
    if status is not None and status not in SETTABLE_CLASSROOM_STATUSES:
        raise ValidationError(
            "A room is set Active or Inactive. In-Use, Available and Occupied describe "
            "live occupancy, which is derived from the timetable rather than entered.",
            code="classroom_status_not_settable",
            fields={"status": [f"{status.value} cannot be set directly."]},
        )


def _assert_code_free(
    db: Session, room_code: str, *, exclude: uuid.UUID | None = None
) -> None:
    """One room per code. Case-insensitive by collation, which is what is wanted here —
    `A-101` and `a-101` are the same door."""
    stmt = select(Classroom.classroomid).where(Classroom.roomcode == room_code)
    if exclude is not None:
        stmt = stmt.where(Classroom.classroomid != exclude)
    if db.scalar(stmt) is not None:
        raise Conflict(
            f"A classroom with code {room_code} already exists.",
            code="duplicate_room_code",
        )


def list_classrooms(
    db: Session,
    *,
    params: PageParams,
    search: str | None = None,
    status: ClassroomStatus | None = None,
) -> Page[ClassroomListItem]:
    """Ordered by building then code — how a person looks for a room."""
    stmt = select(Classroom)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            Classroom.roomcode.like(term)
            | Classroom.building.like(term)
            | Classroom.room_type.like(term)
        )
    if status is not None:
        stmt = stmt.where(Classroom.status == status)

    page = paginate(
        db,
        stmt.order_by(Classroom.building.asc(), Classroom.roomcode.asc()),
        params,
        serialize=_item,
    )
    # Counted after the window, in ONE query, the same shape the students directory uses:
    # `serialize` sees one row at a time and cannot batch, and a count per row would be an
    # N+1 across the page.
    counts = _offering_counts(db, [item.id for item in page.items])
    for item in page.items:
        item.offering_count = counts.get(item.id, 0)
    return page


def get_classroom(db: Session, *, room_id: uuid.UUID) -> ClassroomDetail:
    return _detail(db, _room_or_404(db, room_id))


def create_classroom(
    db: Session, *, actor: User, payload: ClassroomWriteRequest
) -> ClassroomDetail:
    if not payload.room_code or not payload.building:
        raise ValidationError(
            "A classroom needs a room code and a building.",
            fields={
                key: ["Required."]
                for key in ("room_code", "building")
                if not getattr(payload, key)
            },
        )
    _assert_settable(payload.status)
    _assert_code_free(db, payload.room_code)

    room = Classroom(
        roomcode=payload.room_code.strip(),
        building=payload.building.strip(),
        capacity=payload.capacity or 0,
        room_type=(payload.room_type or "").strip() or None,
        status=payload.status or ClassroomStatus.ACTIVE,
        created_by=actor.id,
    )
    db.add(room)
    db.commit()
    return _detail(db, room)


def update_classroom(
    db: Session, *, actor: User, room_id: uuid.UUID, payload: ClassroomWriteRequest
) -> ClassroomDetail:
    """Applies only the keys PRESENT, so a partial save cannot blank what it omits."""
    room = _room_or_404(db, room_id)
    supplied = payload.model_dump(exclude_unset=True)
    _assert_settable(payload.status)

    if "room_code" in supplied:
        if not supplied["room_code"]:
            raise ValidationError(
                "A classroom needs a room code.", fields={"room_code": ["Required."]}
            )
        _assert_code_free(db, supplied["room_code"], exclude=room.classroomid)
        room.roomcode = supplied["room_code"].strip()
    if "building" in supplied:
        if not supplied["building"]:
            raise ValidationError(
                "A classroom needs a building.", fields={"building": ["Required."]}
            )
        room.building = supplied["building"].strip()
    if "capacity" in supplied:
        room.capacity = supplied["capacity"] or 0
    if "room_type" in supplied:
        room.room_type = (supplied["room_type"] or "").strip() or None
    if "status" in supplied and supplied["status"] is not None:
        room.status = supplied["status"]

    room.edited_by = actor.id
    room.edited_on = utcnow()
    db.commit()
    return _detail(db, room)


def delete_classroom(db: Session, *, room_id: uuid.UUID) -> None:
    """HARD delete, and refused while any live offering points at the room.

    Not soft-deleted, unlike `programs` and `courses`: a room carries no history worth
    keeping and no report ever names one. The FK is `ON DELETE SET NULL`, so the database
    would happily degrade those offerings to "no room" — this refuses first, because
    silently unrooming eight scheduled classes is not something a delete button should do
    without saying so.
    """
    room = _room_or_404(db, room_id)
    in_use = _offering_counts(db, [room.classroomid]).get(room.classroomid, 0)
    if in_use:
        raise Conflict(
            f"{room.label} is assigned to {in_use} course offering"
            f"{'s' if in_use != 1 else ''}. Reassign them before deleting the room, or "
            f"set it Inactive instead.",
            code="classroom_in_use",
        )
    db.delete(room)
    db.commit()
