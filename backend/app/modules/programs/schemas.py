"""Programme + curriculum schemas (D30 §D3).

Write models set `extra="forbid"` (api-spec §1.4). Wire format snake_case.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import CourseComponent

CODE_MAX = 10
NAME_MAX = 250


class ProgramListItem(BaseModel):
    """GET /programs item."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str
    award: str | None = None
    #: D44, from the client's `sims_10` dump. Prose, not rules: `program_courses` and
    #: `course_prerequisites` already express what the system can ENFORCE, and these two
    #: are the prospectus text around them.
    admission_requirements: str | None = None
    graduation_requirements: str | None = None
    #: D44. Registrar's free-text notes on the programme.
    comments: str | None = None
    #: D45 §8 — Department Management on the programme, BAJC's actual organising unit.
    #: `head_of_department` is a DISPLAYED name; `program_heads` remains the authoritative
    #: link and the only thing the HOD role's scoping reads.
    head_of_department: str | None = None
    office_information: str | None = None
    #: Total credits as PRINTED on the programme's course sequence (86–102).
    total_credits: int | None = None
    #: The programme's pass mark as a grade point — 2.50 (C+) everywhere except
    #: Primary Education, which is 2.00 (C). See `Program`.
    min_passing_grade_point: Decimal
    is_active: bool
    #: How many courses the curriculum currently lists. Cheap to compute and it is the
    #: one number that says at a glance whether a programme has been built out yet.
    course_count: int = 0
    #: Sum of `courses.credits` across the curriculum. Compared against
    #: `total_credits` by the UI, so a half-entered sequence is visible rather than
    #: quietly wrong.
    curriculum_credits: int = 0


class CourseRef(BaseModel):
    """The catalog course a curriculum row points at."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str
    credits: int
    component: CourseComponent | None = None
    is_active: bool


class ProgramCourseItem(BaseModel):
    """One course in a programme's plan."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course: CourseRef
    is_required: bool


class TermBlock(BaseModel):
    """One curriculum position and everything the plan puts in it.

    NOT a calendar term — see `ProgramCourse`. `term_order` drives display order and
    is what makes "Spring 1" sit between "Semester 2" and "Semester 3" for Primary
    Education without the label having to be parseable.
    """

    term_label: str
    term_order: int
    credits: int
    courses: list[ProgramCourseItem]


class ProgramDetail(ProgramListItem):
    """GET /programs/{id} — the programme plus its curriculum, grouped by block."""

    curriculum: list[TermBlock] = Field(default_factory=list)


class ProgramCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=CODE_MAX)
    name: str = Field(min_length=1, max_length=NAME_MAX)
    award: str | None = Field(default=None, max_length=100)
    # D45 widened both to Text — 100 characters could not hold a requirements paragraph.
    admission_requirements: str | None = None
    graduation_requirements: str | None = None
    comments: str | None = None
    #: D45 §8.
    head_of_department: str | None = Field(default=None, max_length=150)
    office_information: str | None = None
    total_credits: int | None = Field(default=None, gt=0, le=999)
    #: Defaults to C+ — correct for seven of the eight BAJC programmes. Primary
    #: Education is the exception and is created with 2.00.
    min_passing_grade_point: Decimal = Field(
        default=Decimal("2.50"), ge=Decimal("0"), le=Decimal("4")
    )


class ProgramUpdateRequest(BaseModel):
    """PATCH /programs/{id}. Omitted field = leave alone."""

    model_config = ConfigDict(extra="forbid")
    code: str | None = Field(default=None, min_length=1, max_length=CODE_MAX)
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    award: str | None = Field(default=None, max_length=100)
    # D44. Nullable AND omittable, which are different things here: `None` sent
    # explicitly clears the field, omitting it leaves it alone. See `update_program`.
    admission_requirements: str | None = None
    graduation_requirements: str | None = None
    comments: str | None = None
    #: D45 §8. Same explicit-null-clears rule as the two above.
    head_of_department: str | None = Field(default=None, max_length=150)
    office_information: str | None = None
    total_credits: int | None = Field(default=None, gt=0, le=999)
    min_passing_grade_point: Decimal | None = Field(
        default=None, ge=Decimal("0"), le=Decimal("4")
    )
    is_active: bool | None = None


class ProgramCourseCreateRequest(BaseModel):
    """POST /programs/{id}/courses — place one course in the plan."""

    model_config = ConfigDict(extra="forbid")
    course_id: UUID
    term_label: str = Field(min_length=1, max_length=50)
    term_order: int = Field(gt=0, le=99)
    is_required: bool = True


class ProgramCourseUpdateRequest(BaseModel):
    """PATCH /programs/{id}/courses/{program_course_id} — move it, or change whether
    it is required. The COURSE itself is not editable: swapping one course for another
    in place is a delete plus an add, and doing it silently would hide the change from
    anyone reading the curriculum."""

    model_config = ConfigDict(extra="forbid")
    term_label: str | None = Field(default=None, min_length=1, max_length=50)
    term_order: int | None = Field(default=None, gt=0, le=99)
    is_required: bool | None = None


# ── Heads of Department (D43) ──────────────────────────────────────────────────
class ProgramHeadItem(BaseModel):
    """One head of this programme, named well enough to render without a second call."""

    model_config = ConfigDict(from_attributes=True)
    teacher_id: UUID
    full_name: str
    staff_number: str
    #: The head's login role. A profile may be appointed here while their `users.role`
    #: is still `teacher` — appointing the head and granting the reach are two acts, and
    #: the screen must be able to SHOW that gap rather than imply the appointment did
    #: something it did not.
    role: str | None = None
    appointed_at: datetime | None = None


class ProgramHeadsResponse(BaseModel):
    items: list[ProgramHeadItem] = Field(default_factory=list)


class ProgramHeadsSetRequest(BaseModel):
    """PUT /programs/{id}/heads — the COMPLETE list of heads, replacing what is there.

    A whole-list PUT rather than add/remove endpoints: the screen edits a multi-select
    and submits it, and two co-heads swapped in one action would otherwise be an add and
    a delete that can half-fail. Sending `[]` clears the appointments, which is how a
    head is removed.
    """

    model_config = ConfigDict(extra="forbid")
    teacher_ids: list[UUID] = Field(default_factory=list)
