"""Classes request/response schemas (api-spec §5 Module 5, FR-CLS-*, FR-SCH-*).

A class is the `Class` ORM row, which under **D29** is one SUBJECT CLASS ("Math-1")
rather than a subject-agnostic homeroom. Write models set `extra="forbid"`
(api-spec §1.4); wire format is snake_case (§1.2). Read models reuse the shared refs
in `app/common/schemas.py`.

Contract reconciled against the finished frontend MSW handler
(`frontend/src/shared/api/mocks/handlers/classes.ts`) which WINS over api-spec on
divergence: `ClassSubjectItem` carries `lead_teacher_id`; there is an extra
`GET /classes/{id}/enrollable-students` returning `{items: StudentRef[]}`.

D29 wire changes (breaking, intentional):
  * `ClassListItem` / `ClassDetail` gained `subject`, `class_subject_id`, `teachers`,
    `lead_teacher_id`, and `meetings` — a subject class is meaningless without them,
    and the list view would otherwise need N follow-up requests to render a row.
  * `ClassCreateRequest.subject_id` is REQUIRED, and teachers + meetings may be set in
    the same call, so "create Math-1, Mr. Smith, Room A, Mon 08:00" is one request.
  * `EnrollmentResult.transferred` is GONE. It reported the old transfer-on-enrol
    behaviour, which D29 deletes outright; `schedule_conflicts` replaces it as the
    thing the office needs warning about.
  * `subject_count` is gone from `ClassListItem` — it is always 1 under D29.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.common.schemas import (
    AcademicYearRef,
    AuditStamp,
    StudentRef,
    SubjectRef,
    TeacherRef,
)


# ──────────────────────────────────────────────────────────────────────────────
# Read models
# ──────────────────────────────────────────────────────────────────────────────
class ClassMeetingItem(BaseModel):
    """One weekly meeting of a subject class — "Mon 08:00–09:30, Room A"."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    #: ISO weekday, 1=Mon … 5=Fri (`app.common.enums.DayOfWeek`).
    day_of_week: int
    start_time: time
    end_time: time
    room: str | None = None


class ScheduleConflict(BaseModel):
    """A timetable clash. Reported, never enforced — see MeetingsResult."""

    #: What is double-booked. `teacher`/`room` come from a meetings write; `student`
    #: comes from an enrol.
    kind: Literal["teacher", "room", "student"]
    #: The clashing party's display name — teacher name, room label, or student name.
    label: str
    #: The OTHER class involved (the one already occupying the slot).
    with_class_id: UUID
    with_class_name: str
    day_of_week: int
    start_time: time
    end_time: time
    #: Ready-to-render sentence. Lives server-side so the warning reads identically in
    #: the class schedule tab and the enrol dialog instead of being formatted twice.
    message: str


class ClassListItem(BaseModel):
    """GET /classes item — one subject class.

    Everything below `is_archived` is derived and attached post-query (the defaults
    let `model_validate` shape the ORM row directly). They are on the LIST item, not
    just the detail, because a subject-class row is unreadable without its subject,
    teacher, and times — and fetching those per row would be N+1 from the client.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    #: The year group this class is FOR ("Lower 6") — a filter, not a roster.
    grade_level: str
    section: str | None = None
    capacity: int | None = None
    enrolled_count: int = 0
    is_archived: bool
    #: None only for a pre-D29 row that never had a subject attached.
    subject: SubjectRef | None = None
    class_subject_id: UUID | None = None
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    meetings: list[ClassMeetingItem] = Field(default_factory=list)


class ClassDetail(BaseModel):
    """GET /classes/{id} + POST/PATCH responses."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    grade_level: str
    section: str | None = None
    capacity: int | None = None
    academic_year: AcademicYearRef
    enrolled_count: int = 0
    over_capacity: bool = False
    is_archived: bool
    subject: SubjectRef | None = None
    class_subject_id: UUID | None = None
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    meetings: list[ClassMeetingItem] = Field(default_factory=list)
    audit: AuditStamp | None = None


class ClassSubjectItem(BaseModel):
    """GET/POST /classes/{id}/subjects item + PUT teachers response.

    `lead_teacher_id` and `actionable_by_caller` follow the frontend contract."""

    class_subject_id: UUID
    subject: SubjectRef
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    assessment_count: int = 0
    is_active: bool
    actionable_by_caller: bool = False


class RosterEntry(BaseModel):
    """GET /classes/{id}/roster item + POST enrollments `enrolled` item."""

    enrollment_id: UUID
    student: StudentRef
    enrolled_at: datetime
    unenrolled_at: datetime | None = None


class EnrollmentResult(BaseModel):
    """POST /classes/{id}/enrollments response.

    D29 removed `transferred`. It existed because enrolling a student used to close
    their enrolment elsewhere in the semester — the "one homeroom" rule. In a sixth
    form that behaviour is a data-loss bug (adding Freddy to Biology would drop him
    from Math), so both the transfer and its report are gone. `schedule_conflicts`
    takes its place: the clash is surfaced, the enrolment still succeeds.
    """

    enrolled: list[RosterEntry] = Field(default_factory=list)
    over_capacity_warning: bool = False
    schedule_conflicts: list[ScheduleConflict] = Field(default_factory=list)


class EnrollableStudents(BaseModel):
    """GET /classes/{id}/enrollable-students response (frontend enroll-dialog picker)."""

    items: list[StudentRef] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Write models
# ──────────────────────────────────────────────────────────────────────────────
class ClassMeetingInput(BaseModel):
    """One meeting in a PUT /classes/{id}/meetings payload."""

    model_config = ConfigDict(extra="forbid")
    #: ISO weekday, Mon–Fri. 6/7 are rejected — the timetable is weekday-only.
    day_of_week: int = Field(ge=1, le=5)
    start_time: time
    end_time: time
    room: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _end_after_start(self) -> ClassMeetingInput:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class MeetingsReplaceRequest(BaseModel):
    """PUT /classes/{id}/meetings (P/S).

    REPLACES the class's whole weekly schedule, mirroring `TeacherAssignRequest`
    rather than inventing per-meeting POST/PATCH/DELETE routes: the UI edits the week
    as one form, and replace-the-set means a reordered or retimed week cannot half-apply.
    An empty list is valid and clears the schedule.
    """

    model_config = ConfigDict(extra="forbid")
    meetings: list[ClassMeetingInput] = Field(default_factory=list)


class MeetingsResult(BaseModel):
    """GET/PUT /classes/{id}/meetings response.

    `conflicts` is advisory. Overlapping a teacher or a room is a real scheduling
    mistake but not always an error (a room can be shared, a clash may be fixed
    minutes later), and hard-blocking would make an otherwise-valid week unsaveable.
    So the write succeeds and the UI warns — the same warn-only call already made for
    over-capacity enrolment (D-Q6).
    """

    meetings: list[ClassMeetingItem] = Field(default_factory=list)
    conflicts: list[ScheduleConflict] = Field(default_factory=list)


class ClassCreateRequest(BaseModel):
    """POST /classes (P/S) — create a subject class.

    `subject_id` is required: a subject class without a subject cannot be graded,
    scheduled, or enrolled into. Teachers and meetings are optional here but accepted
    so the whole "Math-1, Mr. Smith, Room A, Mon 08:00–09:30" can be created in one
    request instead of three. `academic_year_id` defaults to the active year.
    """

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=150)
    subject_id: UUID
    #: Year group the class is for, e.g. "Lower 6".
    grade_level: str = Field(min_length=1, max_length=50)
    section: str | None = Field(default=None, max_length=2)
    capacity: int | None = Field(default=None, gt=0)
    academic_year_id: UUID | None = None
    teacher_ids: list[UUID] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    meetings: list[ClassMeetingInput] = Field(default_factory=list)


class ClassUpdateRequest(BaseModel):
    """PATCH /classes/{id} (P/S). Partial. Year is not re-assignable here.

    The subject is not editable either: changing it would silently reinterpret every
    existing assessment and grade under the class. Create a new class instead.
    """

    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=150)
    grade_level: str | None = Field(default=None, min_length=1, max_length=50)
    section: str | None = Field(default=None, max_length=2)
    capacity: int | None = Field(default=None, gt=0)


class ClassSubjectCreateRequest(BaseModel):
    """POST /classes/{id}/subjects (P/S) — attach a subject to the section."""

    model_config = ConfigDict(extra="forbid")
    subject_id: UUID


class TeacherAssignRequest(BaseModel):
    """PUT /classes/{class_id}/subjects/{cs_id}/teachers (P/S).

    Replaces the teacher set. Empty list is allowed (removes all). `lead_teacher_id`
    must be a member of `teacher_ids`; defaults to `teacher_ids[0]` when omitted."""

    model_config = ConfigDict(extra="forbid")
    teacher_ids: list[UUID] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None


class EnrollRequest(BaseModel):
    """POST /classes/{id}/enrollments (P/S). `semester_id` defaults to active."""

    model_config = ConfigDict(extra="forbid")
    student_ids: list[UUID] = Field(min_length=1)
    semester_id: UUID | None = None
