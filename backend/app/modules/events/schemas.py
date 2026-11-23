"""Calendar event schemas (Module 12).

Shapes mirror `frontend/src/features/calendar/types.ts` and
`frontend/src/shared/api/mocks/handlers/events.ts` exactly. Write models set
`extra="forbid"` (api-spec §1.4); wire format is snake_case.

`start_time`/`end_time` cross the wire as `HH:mm` strings, not Python's default
`HH:MM:SS` — the frontend's `EventFormDialog` binds them straight to `<input
type="time">`, which rejects a seconds component.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_serializer

from app.modules.events.models import EventCategory, EventVisibility

#: Titles strip before length validation, so a whitespace-only title is a 422 on
#: `title` rather than a successfully created event named "   ".
EventTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
]


class EventAuthor(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    full_name: str


class EventView(BaseModel):
    """One calendar entry as the frontend's `CalendarEvent` expects it."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    description: str | None = None
    category: EventCategory
    visibility: EventVisibility
    start_date: date
    end_date: date | None = None
    all_day: bool
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = None
    created_by: EventAuthor
    created_at: datetime

    @field_serializer("start_time", "end_time")
    def _hhmm(self, value: time | None) -> str | None:
        return None if value is None else value.strftime("%H:%M")


class EventListResponse(BaseModel):
    """GET /events. Not `Page[T]`: the calendar renders a whole month at once and
    has no pagination affordance, so paging it would strand events off-page.

    `reference_date` is the server's today. The calendar opens onto it instead of
    trusting the browser clock.
    """

    items: list[EventView]
    reference_date: date


class EventCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: EventTitle
    description: str | None = Field(default=None, max_length=4000)
    category: EventCategory = EventCategory.OTHER
    visibility: EventVisibility = EventVisibility.GLOBAL
    start_date: date
    end_date: date | None = None
    all_day: bool = True
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = Field(default=None, max_length=200)


class EventUpdateRequest(BaseModel):
    """PATCH /events/{id}. Every field optional; unset fields are left alone.

    `None` is a meaningful value here (clearing a description or an end date), so
    the service distinguishes "absent" from "explicitly null" via
    `model_dump(exclude_unset=True)` rather than testing for `None`.
    """

    model_config = ConfigDict(extra="forbid")
    title: EventTitle | None = None
    description: str | None = Field(default=None, max_length=4000)
    category: EventCategory | None = None
    visibility: EventVisibility | None = None
    start_date: date | None = None
    end_date: date | None = None
    all_day: bool | None = None
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = Field(default=None, max_length=200)
