"""Timetable response schemas (FR-SCH-03..05).

The weekly Mon–Fri view of whatever course offerings the viewer is attached to — the
offerings a student is enrolled in, or the ones a lecturer teaches (D29, D31).

Shape note: the response is pre-bucketed by day (`days: [{day_of_week, entries}]`)
rather than a flat list of meetings. The only consumers are grid/agenda views that
have to render five columns (or five day groups on mobile), so grouping server-side
means the client never re-derives it, and an empty day is explicit — a flat list makes
"Wednesday has no classes" indistinguishable from "Wednesday was dropped".
"""

from __future__ import annotations

from datetime import time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.schemas import OfferingRef, StudentRef, TeacherRef


class TimetableEntry(BaseModel):
    """One meeting of one offering, as it appears in a week view.

    D31 collapsed `class_id`/`class_name` + `offering_id`/`subject` into one
    `OfferingRef`. Those were four fields describing two rows; a homeroom and the
    subject it taught are the same row now, so `class_id` and `offering_id` had
    become the same UUID sent twice under different names.
    """

    model_config = ConfigDict(from_attributes=True)
    meeting_id: UUID
    offering: OfferingRef
    #: Who teaches it. Present for a student's timetable; for a teacher's own
    #: timetable it is their co-teachers (D16 allows more than one per offering).
    teachers: list[TeacherRef] = Field(default_factory=list)
    room: str | None = None
    day_of_week: int
    start_time: time
    end_time: time


class UnscheduledOffering(BaseModel):
    """An offering the viewer belongs to that has no meetings set yet.

    Same identity as `TimetableEntry` minus the slot — there is no slot, which is
    exactly what makes it worth reporting.
    """

    offering: OfferingRef
    teachers: list[TeacherRef] = Field(default_factory=list)


class TimetableDay(BaseModel):
    """One weekday, entries in start-time order. Present even when empty."""

    day_of_week: int
    #: "Monday" — sent so the client is not the second place that maps 1→Monday.
    day_name: str
    entries: list[TimetableEntry] = Field(default_factory=list)


class TimetableView(BaseModel):
    """GET /timetable/me and GET /students/{id}/timetable.

    `unscheduled` is the point of the whole envelope: an offering the viewer belongs to
    that has no meetings yet would otherwise silently vanish from the timetable, and
    "my Biology class is missing" is indistinguishable from "I'm not enrolled". Listing
    them separately makes the gap visible and tells the office what to schedule.
    """

    #: Whose timetable this is — set for the P/S per-student view, null for /me.
    student: StudentRef | None = None
    #: Academic year the timetable was resolved for (null if the school has none).
    academic_year_id: UUID | None = None
    days: list[TimetableDay] = Field(default_factory=list)
    unscheduled: list[UnscheduledOffering] = Field(default_factory=list)
