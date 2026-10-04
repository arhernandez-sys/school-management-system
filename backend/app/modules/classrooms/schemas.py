"""Classroom wire schemas (D44)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import ClassroomStatus


class ClassroomRef(BaseModel):
    """The minimal room, for embedding on an offering.

    Carries `label` prebuilt for the same reason `OfferingRef` does: the display string is
    derived, and a client assembling its own copy is a second formula to keep in step.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    room_code: str
    building: str
    label: str


class ClassroomListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    room_code: str
    building: str
    capacity: int
    room_type: str | None = None
    status: ClassroomStatus
    label: str
    #: How many live offerings are scheduled here. The delete confirmation needs it, and
    #: so does anyone deciding whether a room is worth keeping.
    offering_count: int = 0


class ClassroomWriteRequest(BaseModel):
    """Create and update share a body; update applies only the keys PRESENT.

    ⚠️ `status` is `SettableClassroomStatus`, NOT the full enum. The column can hold
    `In-Use`/`Available`/`Occupied` because the client's dump does, but those describe
    live occupancy — a fact `class_meetings` derives and that goes stale within the hour
    if someone types it into a form. See `ClassroomStatus`.
    """

    model_config = ConfigDict(extra="forbid")
    room_code: str | None = Field(default=None, min_length=1, max_length=25)
    building: str | None = Field(default=None, min_length=1, max_length=60)
    capacity: int | None = Field(default=None, ge=0)
    room_type: str | None = Field(default=None, max_length=150)
    status: ClassroomStatus | None = None


class ClassroomDetail(ClassroomListItem):
    created_on: datetime
    #: NULL until edited — the 015 convention, which the client's table already matched.
    edited_on: datetime | None = None
