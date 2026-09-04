"""Grades request/response schemas (api-spec Module 7, FR-GRD-*).

Read shapes are reconciled to the finished frontend contract, which WINS on any
divergence: `frontend/src/features/grades/types.ts` +
`frontend/src/shared/api/mocks/handlers/grades.ts`.

One deliberate divergence is load-bearing:

* `letter` is `letter?: string` on the wire, never `string | null`. Pydantic
  would emit an explicit `null`, so `_LetterOptional` drops the key when unset.

**D31 removed the other one.** Grades used to define its own `ClassSubjectRef` — keyed
`id` where Assessments keyed `offering_id`, carrying `display_name` and a "fat" section
ref (`grade_level`, `section`). Assessments and Attendance each had a third variant, and
the note here said none were interchangeable. That was true, and it was the problem: an
offering's label is DERIVED now (`offerings/labels.py`), so three private derivations of
one string would drift and the screens would show the drift. All three modules now carry
the shared `common.schemas.OfferingRef`; what stays local is only what is genuinely
module-specific — here, the staffing (`teachers[]`, `lead_teacher_id`) the picker needs.

Write models set `extra="forbid"` (§1.4); wire is snake_case (§1.2).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_serializer

from app.common.enums import (
    AssessmentStatus,
    AssessmentType,
    GradeRevisionStatus,
    GradeStatus,
)
from app.common.schemas import OfferingRef


# ── Letter handling ────────────────────────────────────────────────────────────
class _LetterOptional(BaseModel):
    """Mixin: emit `letter` only when it resolved to a value.

    The frontend types declare `letter?: string` and the MSW handler spreads the
    key in conditionally (`...(graded && score != null ? { letter } : {})`), so a
    literal `"letter": null` is off-contract. A plain optional field would emit
    exactly that, hence the wrap serializer.
    """

    letter: str | None = None

    @model_serializer(mode="wrap")
    def _omit_null_letter(self, handler) -> dict[str, Any]:  # noqa: ANN001
        data = handler(self)
        if data.get("letter") is None:
            data.pop("letter", None)
        return data


# ── Refs (frontend shape) ──────────────────────────────────────────────────────
class TeacherRef(BaseModel):
    id: UUID
    full_name: str


class GradesOfferingRef(BaseModel):
    """The shared `OfferingRef`, plus who is assigned to teach it.

    Staffing lives here rather than in the shared ref because it is a gradebook
    concern: `teachers[0]` is rendered as the owner, and `lead_teacher_id` is who the
    screens attribute the marks to. Identifying and naming the offering is the shared
    ref's job.
    """

    offering: OfferingRef
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None


class StudentRef(BaseModel):
    id: UUID
    full_name: str
    student_number: str


class SemesterRef(BaseModel):
    id: UUID
    name: str
    sequence: int


# ── GET /grades/offerings ─────────────────────────────────────────────────
class OfferingOption(GradesOfferingRef):
    assessment_count: int = 0
    #: Whether THIS caller may enter grades here (teacher who owns the offering).
    can_edit: bool = False


class OfferingOptionsResponse(BaseModel):
    items: list[OfferingOption] = Field(default_factory=list)


# ── GET /grades/offering/{id} ─────────────────────────────────────────────
class GradebookAssessment(BaseModel):
    id: UUID
    title: str
    type: AssessmentType
    category_id: UUID | None = None
    max_score: float
    weight: float
    assessment_date: date | None = None
    status: AssessmentStatus
    is_released: bool
    #: Drafts are shown as columns but reject entry.
    is_editable: bool
    graded_count: int = 0
    entered_count: int = 0


class GradebookCategory(BaseModel):
    id: UUID
    name: str
    weight: float
    drop_lowest_count: int = 0


class GradebookCell(_LetterOptional):
    assessment_id: UUID
    status: GradeStatus = GradeStatus.PENDING
    score: float | None = None
    makeup_score: float | None = None
    #: `grade.is_released ?? assessment.is_released`.
    is_released: bool = False
    #: D32 (brief §1) — may a Lecturer file a Revision of Grades against THIS result?
    #:
    #: Server-computed rather than re-derived in the browser, because the four rules read
    #: `assessments.created_at`, `assessment_grades.graded_at` and the term's mid-term
    #: window — none of which the gradebook payload carries, and all of which the client
    #: would have to be trusted to combine identically to `create_revision`. Sending the
    #: verdict keeps one implementation of the rule.
    #:
    #: Always `false` for a non-Lecturer viewer: the Dean decides revisions and does not
    #: file them (§D7), and a Registrar has no grade authority at all.
    can_request_revision: bool = False
    #: The reason code from `REVISION_BLOCKED_REASONS` when `can_request_revision` is
    #: false, so the tooltip can say WHICH rule bit instead of greying a button silently.
    #: `None` when the request is allowed, or when the viewer is not a Lecturer.
    revision_blocked_reason: str | None = None


class GradebookRow(BaseModel):
    student: StudentRef
    #: NULL for a non-member row retained only because a grade exists.
    enrollment_id: UUID | None = None
    is_active_member: bool = True
    cells: list[GradebookCell] = Field(default_factory=list)
    term_numeric: float | None = None
    term_letter: str | None = None


class Gradebook(BaseModel):
    offering: GradesOfferingRef | None = None
    semester: SemesterRef | None = None
    assessments: list[GradebookAssessment] = Field(default_factory=list)
    categories: list[GradebookCategory] = Field(default_factory=list)
    rows: list[GradebookRow] = Field(default_factory=list)
    drop_lowest_applied: bool = False
    can_edit: bool = False
    #: D30 §D6, **retired by D42 §5**. These two always report `False` / `None` now —
    #: the end-of-session deadline is neither configurable nor enforced. Kept on the wire
    #: so a client built against the older contract still parses the response; new
    #: readers should ignore them and look at `midterm_frozen` instead.
    grade_window_closed: bool = False
    grade_submission_deadline: datetime | None = None
    #: D33 (client ask 7). True while `[midterm_submission_start, midterm_submission_end]`
    #: is running, during which NOBODY enters a grade for this term.
    #:
    #: Deliberately SEPARATE from `can_edit`, which keeps its meaning of "this caller's
    #: role and ownership permit writing here". The two are answered differently by the
    #: Lecturer: `can_edit=false` → "not yours"; `midterm_frozen` → "wait; it reopens on
    #: this date". The window dates travel with it so the UI can name that date instead
    #: of saying "later".
    midterm_frozen: bool = False
    midterm_submission_start: datetime | None = None
    midterm_submission_end: datetime | None = None
    viewer_role: str


# ── PUT /assessments/{id}/grades ───────────────────────────────────────────────
class GradeEntryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_id: UUID
    status: GradeStatus
    score: float | None = None
    makeup_score: float | None = None


class GradeEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entries: list[GradeEntryItem] = Field(default_factory=list)


class GradeCellResult(_LetterOptional):
    student_id: UUID
    status: GradeStatus
    score: float | None = None
    makeup_score: float | None = None


class GradeEntryResponse(BaseModel):
    updated: list[GradeCellResult] = Field(default_factory=list)


# ── GET /grades/term ───────────────────────────────────────────────────────────
class TermGradeItem(BaseModel):
    student: StudentRef | None = None
    offering: GradesOfferingRef | None = None
    semester: SemesterRef | None = None
    numeric: float | None = None
    letter: str | None = None
    weight_base_used: float | None = None
    #: True when the value was read from `term_grade_snapshots` (archived year).
    is_frozen: bool = False
    effective_policy: dict[str, Any] | None = None


class TermGradeList(BaseModel):
    items: list[TermGradeItem] = Field(default_factory=list)


# ── GET /grades/me ─────────────────────────────────────────────────────────────
class MyGradeAssessment(_LetterOptional):
    assessment_id: UUID
    title: str
    type: AssessmentType
    max_score: float
    assessment_date: date | None = None
    status: GradeStatus
    score: float | None = None


class MyGradeSubject(BaseModel):
    offering: GradesOfferingRef | None = None
    teacher: TeacherRef | None = None
    assessments: list[MyGradeAssessment] = Field(default_factory=list)
    term_numeric: float | None = None
    term_letter: str | None = None


class MyGrades(BaseModel):
    student: StudentRef
    by_subject: list[MyGradeSubject] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Grade revision / second opportunity (D30 §D7, brief §20)
# ──────────────────────────────────────────────────────────────────────────────
class GradeRevisionCreateRequest(BaseModel):
    """POST /assessments/{id}/grade-revisions — the LECTURER asks (brief §20).

    Assessment-first and student-identified, exactly as the brief describes the flow: the
    Lecturer identifies the student and the assessment, states a reason, and proposes the
    new result. Addressed this way rather than by `assessment_grade_id` because that id is
    an internal join key the Lecturer never sees — they are looking at a gradebook row.
    """

    model_config = ConfigDict(extra="forbid")
    student_id: UUID
    #: Required. A revision with no stated reason gives the Dean nothing to rule on, and
    #: brief §20 asks for a description explicitly.
    reason: str = Field(min_length=1)
    #: The mark the Lecturer is asking for. Validated against the assessment's `max_score`
    #: by the service — the schema cannot know it.
    proposed_score: float = Field(ge=0)


class GradeRevisionDecisionRequest(BaseModel):
    """POST /grade-revisions/{id}/decision — **DEAN ONLY** (§D14).

    `pending` is not accepted: a decision endpoint that could un-decide would leave no
    record of the reversal, which is the opposite of what this table exists for.
    """

    model_config = ConfigDict(extra="forbid")
    status: GradeRevisionStatus = Field(description="approved or denied")
    #: Optional either way, and appended rather than overwritten.
    decision_note: str | None = None


class GradeRevisionRead(BaseModel):
    """One request, with everything §D8 says a notification must identify.

    Deliberately FAT: the Dean's queue has to be workable without a fetch per row, and
    §D8 lists student, course, assessment, lecturer, request date, reason and status as
    what the notification carries. All of it is here.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    assessment_grade_id: UUID
    status: GradeRevisionStatus
    reason: str
    original_score: float | None = None
    proposed_score: float
    decision_note: str | None = None
    decided_at: datetime | None = None
    created_at: datetime

    student: StudentRef | None = None
    assessment_id: UUID | None = None
    assessment_title: str = ""
    #: The assessment's own ceiling, so a queue row can show "82 → 91 of 100" without a
    #: second call.
    max_score: float | None = None
    #: Which offering the disputed mark belongs to. D31 replaced the flat
    #: `offering_id` + `subject_name` + `subject_code` + `section_name` quartet: three of
    #: those were the offering's own identity spelled out by hand, and `section_name`
    #: read a homeroom column that no longer exists.
    offering: OfferingRef | None = None
    #: Who asked. `requested_by_user_id` is kept alongside so the caller can tell whether a
    #: row is their own without matching on a display name.
    requested_by_user_id: UUID
    requested_by_name: str = ""
    decided_by_user_id: UUID | None = None
    decided_by_name: str | None = None
    #: True when the caller may still withdraw this request — their own, still pending.
    can_withdraw: bool = False


class GradeRevisionList(BaseModel):
    items: list[GradeRevisionRead] = Field(default_factory=list)
    #: Awaiting the CALLER's decision. Non-zero only for the Dean, which is what makes it
    #: safe to drive a notification badge from (§D8).
    pending_for_me: int = 0
