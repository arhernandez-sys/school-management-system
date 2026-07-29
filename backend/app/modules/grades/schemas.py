"""Grades request/response schemas (api-spec Module 7, FR-GRD-*).

Read shapes are reconciled to the finished frontend contract, which WINS on any
divergence: `frontend/src/features/grades/types.ts` +
`frontend/src/shared/api/mocks/handlers/grades.ts`.

Two deliberate divergences from the assessments module are load-bearing:

* Grades has its **own** `ClassSubjectRef`. The key is `id` (NOT
  `class_subject_id`), it carries `teachers[]` / `lead_teacher_id` /
  `display_name`, and its `section` ref is the fat one (`grade_level` +
  `section`). Reusing `assessments.schemas.ClassSubjectRef` would silently
  break every Grades screen. Attendance has a third variant again — none of the
  three are interchangeable.
* `letter` is `letter?: string` on the wire, never `string | null`. Pydantic
  would emit an explicit `null`, so `_LetterOptional` drops the key when unset.

Write models set `extra="forbid"` (§1.4); wire is snake_case (§1.2).
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_serializer

from app.common.enums import AssessmentStatus, AssessmentType, GradeStatus


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
class SectionRef(BaseModel):
    """Fat section ref. `section` is nullable in the ORM but a non-nullable
    `string` in the frontend type, so the service coerces `None` -> `""`."""

    id: UUID
    name: str
    grade_level: str
    section: str = ""


class SubjectRef(BaseModel):
    id: UUID
    name: str
    code: str | None = None


class TeacherRef(BaseModel):
    id: UUID
    full_name: str


class ClassSubjectRef(BaseModel):
    """Grades' class_subject ref — keyed on `id`, NOT `class_subject_id`."""

    id: UUID
    section: SectionRef | None = None
    subject: SubjectRef | None = None
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    display_name: str = ""


class StudentRef(BaseModel):
    id: UUID
    full_name: str
    student_number: str


class SemesterRef(BaseModel):
    id: UUID
    name: str
    sequence: int


# ── GET /grades/class-subjects ─────────────────────────────────────────────────
class ClassSubjectOption(ClassSubjectRef):
    assessment_count: int = 0
    #: Whether THIS caller may enter grades here (teacher who owns the offering).
    can_edit: bool = False


class ClassSubjectOptionsResponse(BaseModel):
    items: list[ClassSubjectOption] = Field(default_factory=list)


# ── GET /grades/class-subject/{id} ─────────────────────────────────────────────
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


class GradebookRow(BaseModel):
    student: StudentRef
    #: NULL for a non-member row retained only because a grade exists.
    enrollment_id: UUID | None = None
    is_active_member: bool = True
    cells: list[GradebookCell] = Field(default_factory=list)
    term_numeric: float | None = None
    term_letter: str | None = None


class Gradebook(BaseModel):
    class_subject: ClassSubjectRef | None = None
    semester: SemesterRef | None = None
    assessments: list[GradebookAssessment] = Field(default_factory=list)
    categories: list[GradebookCategory] = Field(default_factory=list)
    rows: list[GradebookRow] = Field(default_factory=list)
    drop_lowest_applied: bool = False
    can_edit: bool = False
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
    class_subject: ClassSubjectRef | None = None
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
    class_subject: ClassSubjectRef | None = None
    teacher: TeacherRef | None = None
    assessments: list[MyGradeAssessment] = Field(default_factory=list)
    term_numeric: float | None = None
    term_letter: str | None = None


class MyGrades(BaseModel):
    student: StudentRef
    by_subject: list[MyGradeSubject] = Field(default_factory=list)
