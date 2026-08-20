"""Course-offering schemas (api-spec §5 Module 5; D31).

WHAT D31 CHANGED IN THIS CONTRACT

    `classes` + `class_subjects` merged into `course_offerings`, so three things went:

      * `ClassListItem.name` / `.grade_level` / `.section` — a stored homeroom name and
        Form level. An offering's identity is its COURSE plus its TERM plus an optional
        section, and its display string is `label` (see `offerings/labels.py`). The label
        is computed server-side and sent, so the API and the demo handlers cannot disagree
        about how an offering is named — the same reasoning that keeps the GPA in one
        function.
      * `ClassSubjectItem` and `ClassSubjectCreateRequest` — an offering IS the subject
        now, so there is nothing to attach or list. `POST /offerings` takes `course_id`
        directly.
      * `academic_year_id` on the create request — an offering is scheduled into a
        SEMESTER. The year is reached through it, never stored alongside it.
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.common.schemas import (
    AcademicYearRef,
    AuditStamp,
    CourseRef,
    SemesterRef,
    StudentRef,
    TeacherRef,
)


class OfferingMeetingItem(BaseModel):
    """One recurring weekly slot of an offering."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    day_of_week: int
    start_time: time
    end_time: time
    room: str | None = None


class ScheduleConflict(BaseModel):
    """An advisory clash. Never blocks a write — see `MeetingsResult`."""

    kind: Literal["teacher", "room", "student"]
    #: The thing that clashes: a lecturer's name, a room name, or a student's name.
    label: str
    with_offering_id: UUID
    #: `offering_label` of the other offering, e.g. "MATH1110-01".
    with_offering_label: str
    day_of_week: int
    start_time: time
    end_time: time
    message: str


class OfferingListItem(BaseModel):
    """A row in GET /offerings.

    `course` carries the credits, because credits live ONLY on the catalog (D31) and
    every listing that names a course also shows what it is worth.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    #: "MATH1110-01" — built by `offering_label`, never assembled client-side.
    label: str = ""
    course: CourseRef | None = None
    semester: SemesterRef | None = None
    section_code: str | None = None
    capacity: int | None = None
    enrolled_count: int = 0
    is_archived: bool
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    meetings: list[OfferingMeetingItem] = Field(default_factory=list)
    #: True when the CALLER may act on this offering (a lecturer who teaches it, or any
    #: Dean/Registrar). Drives whether the row's actions render.
    actionable_by_caller: bool = False


class OfferingDetail(BaseModel):
    """GET /offerings/{id}."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    label: str = ""
    course: CourseRef | None = None
    semester: SemesterRef | None = None
    #: Derived through the semester — an offering does not store its year (D31).
    academic_year: AcademicYearRef | None = None
    section_code: str | None = None
    capacity: int | None = None
    enrolled_count: int = 0
    over_capacity: bool = False
    is_archived: bool
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    meetings: list[OfferingMeetingItem] = Field(default_factory=list)
    assessment_count: int = 0
    actionable_by_caller: bool = False
    audit: AuditStamp | None = None


class RosterEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    enrollment_id: UUID
    student: StudentRef
    enrolled_at: datetime
    unenrolled_at: datetime | None = None


class EnrollmentResult(BaseModel):
    """POST /offerings/{id}/enrollments.

    `over_capacity_warning` and `schedule_conflicts` are advisory: the enrolment
    succeeded. A missing PREREQUISITE, by contrast, is a hard 409 — unlike a timetable
    clash it is not fixed by the next edit (D30 §D4, D-Q6).
    """

    enrolled: list[RosterEntry] = Field(default_factory=list)
    over_capacity_warning: bool = False
    schedule_conflicts: list[ScheduleConflict] = Field(default_factory=list)


class EnrollableStudents(BaseModel):
    items: list[StudentRef] = Field(default_factory=list)


class OfferingMeetingInput(BaseModel):
    """One submitted slot. `day_of_week` is Mon-Fri; `end_time` must follow `start_time`.

    The time order is validated HERE rather than left to the database. `class_meetings`
    carries `ck_class_meetings_time_order`, so an inverted slot was always refused — but
    as an `OperationalError` raised mid-write, which surfaces as a 500 instead of the 422
    the caller can act on. A constraint the API can check before it writes should be
    checked before it writes; the CHECK stays as the backstop for anything that reaches
    the table another way.
    """

    model_config = ConfigDict(extra="forbid")

    day_of_week: int = Field(ge=1, le=5)
    start_time: time
    end_time: time
    room: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _end_after_start(self) -> "OfferingMeetingInput":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class MeetingsReplaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meetings: list[OfferingMeetingInput] = Field(default_factory=list)


class MeetingsResult(BaseModel):
    """GET/PUT /offerings/{id}/meetings.

    `conflicts` is advisory. Overlapping a lecturer or a room is a real scheduling
    mistake but not always an error (a room can be shared, a clash may be fixed minutes
    later), and hard-blocking would make an otherwise-valid week unsaveable. So the write
    succeeds and the UI warns — the same warn-only call already made for over-capacity
    enrolment (D-Q6).
    """

    meetings: list[OfferingMeetingItem] = Field(default_factory=list)
    conflicts: list[ScheduleConflict] = Field(default_factory=list)


class OfferingCreateRequest(BaseModel):
    """POST /offerings (Dean or Registrar) — schedule a course in a term.

    `course_id` and `semester_id` together with `section_code` ARE the offering's
    identity. Lecturers and meetings are optional but accepted so the whole
    "MATH1110-01, Prof. Cano, Room A, Mon 08:00-09:30" can be created in one request
    instead of three. `semester_id` defaults to the active term.

    There is no `name`: the label is derived (D31). There is no `academic_year_id`: the
    year follows from the semester.
    """

    model_config = ConfigDict(extra="forbid")

    course_id: UUID
    semester_id: UUID | None = None
    #: "01", "02" for parallel sections of the same course in the same term.
    section_code: str | None = Field(default=None, max_length=10)
    capacity: int | None = Field(default=None, gt=0)
    teacher_ids: list[UUID] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    meetings: list[OfferingMeetingInput] = Field(default_factory=list)


class OfferingUpdateRequest(BaseModel):
    """PATCH /offerings/{id} (Dean or Registrar). Partial.

    Neither `course_id` nor `semester_id` is editable: changing either would silently
    reinterpret every assessment, grade and attendance record already recorded against
    the offering. Create another offering instead.
    """

    model_config = ConfigDict(extra="forbid")

    section_code: str | None = Field(default=None, max_length=10)
    capacity: int | None = Field(default=None, gt=0)
    is_archived: bool | None = None


class TeacherAssignRequest(BaseModel):
    """PUT /offerings/{id}/teachers (Dean or Registrar).

    Replaces the lecturer set. Empty list is allowed (removes all). `lead_teacher_id`
    must be a member of `teacher_ids`; defaults to `teacher_ids[0]` when omitted.
    """

    model_config = ConfigDict(extra="forbid")

    teacher_ids: list[UUID] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None


class EnrollRequest(BaseModel):
    """POST /offerings/{id}/enrollments. `semester_id` defaults to the offering's own."""

    model_config = ConfigDict(extra="forbid")

    student_ids: list[UUID] = Field(min_length=1)
    semester_id: UUID | None = None
