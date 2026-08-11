"""Students request/response schemas (api-spec §5 Module 3, FR-STU-01..10).

Write models set `extra="forbid"` (api-spec §1.4) so a typo'd field fails loudly
(422) rather than being silently dropped. Wire format is snake_case (§1.2). Read
models reuse the shared refs in `app/common/schemas.py` (ClassRef, AuditStamp,
SubjectRef) where possible; the few here are Students-specific payloads.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import (
    AcademicYearStatus,
    AssessmentType,
    GradeStatus,
    StudentStatus,
)
from app.common.schemas import AuditStamp, ClassRef, SubjectRef


# ──────────────────────────────────────────────────────────────────────────────
# Read models (api-spec §5.3)
# ──────────────────────────────────────────────────────────────────────────────
class StudentListItem(BaseModel):
    """GET /students item (api-spec §5.3).

    D29 replaced `current_section` (one homeroom) with `year_group` + `class_count`.
    The list needs a scannable level and "how many subjects do they take"; the class
    NAMES belong on the detail page, and putting a variable-length list in a table cell
    was the alternative.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    student_number: str
    full_name: str
    status: StudentStatus
    #: The student's own level, e.g. "Lower 6" (D29). Was read off their homeroom.
    year_group: str | None = None
    #: Active subject classes for the resolved semester.
    class_count: int = 0
    guardian_name: str | None = None


class StudentDetail(BaseModel):
    """GET /students/{id}, /students/me + POST/PATCH/status responses.

    Mirrors `student_profiles` (schema §3.B) plus the derived `current_classes` (every
    subject class the student actively sits, D29) and the audit stamp.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    student_number: str
    full_name: str
    date_of_birth: date
    gender: str | None = None
    year_group: str | None = None
    enrollment_date: date
    status: StudentStatus
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian_email: str | None = None
    address: str | None = None
    phone: str | None = None
    #: Every subject class the student is actively enrolled in, name-ordered.
    current_classes: list[ClassRef] = Field(default_factory=list)
    audit: AuditStamp | None = None


class StudentAssessmentLine(BaseModel):
    """One assessment row under a subject group (GET /students/{id}/assessments).

    `status` is the **student's grade status** — `pending` when no
    `assessment_grades` row exists yet — NOT the assessment's lifecycle status.
    `score` is withheld (`null`) unless the result is released AND graded; the row
    itself is still listed, because the viewer here is an admin/teacher rather
    than the student (contrast `GET /grades/me`, which drops unreleased rows).
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    type: AssessmentType
    max_score: float
    weight: float | None = None
    assessment_date: date | None = None
    status: GradeStatus
    score: float | None = None
    is_released: bool
    #: When a principal/secretary last reminded the teacher to release this
    #: assessment (UTC), or `null` if never. Lets the Grades tab render
    #: "Reminded 2h ago" and disable the button for the remainder of the cooldown,
    #: instead of letting the user click into a 429.
    last_nudged_at: datetime | None = None


class StudentTermGrade(BaseModel):
    """The student's computed term grade for one offering. Both members are null
    when nothing has participated yet (all pending / excused / zero weight)."""

    numeric: float | None = None
    letter: str | None = None


class StudentAssessmentGroup(BaseModel):
    """GET /students/{id}/assessments group — one `class_subject` offering.

    The numbers come from `grades.service.student_assessment_groups`, which routes
    the arithmetic through the single grade engine (`grades/calc.py`); nothing is
    recomputed here.
    """

    class_subject_id: UUID
    subject: SubjectRef | None = None
    term_grade: StudentTermGrade
    assessments: list[StudentAssessmentLine] = Field(default_factory=list)


class StudentAssessmentsResponse(BaseModel):
    """GET /students/{id}/assessments (api-spec §5.3, FR-ASMT-06).

    An `{items:[...]}` envelope, not a bare array — the frontend reads
    `res.data.items` (`features/students/api/studentsApi.ts`).
    """

    items: list[StudentAssessmentGroup] = Field(default_factory=list)
    #: The `POST /assessments/{id}/nudge-release` cooldown, served here so the SPA
    #: computes "still within the cooldown" from the server's window rather than a
    #: hardcoded copy that would silently drift if the window is retuned.
    nudge_cooldown_seconds: int = 0


class StudentYearItem(BaseModel):
    """One academic year the student was actually enrolled in."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    status: AcademicYearStatus


class StudentYearsResponse(BaseModel):
    """GET /students/{id}/years and GET /students/me/years — newest year first.

    Backs the student year-switcher (`app/providers/YearContext.tsx`) and the
    per-student year filter on the profile page; both read `res.data.items`.
    """

    items: list[StudentYearItem] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Write models (api-spec §5.3)
# ──────────────────────────────────────────────────────────────────────────────
class StudentCreateRequest(BaseModel):
    """POST /students (api-spec §5.3, FR-STU-01/02/05).

    `status` is accepted here (defaults active). Lifecycle CHANGES after creation
    go through POST /students/{id}/status — not PATCH.

    D29: `class_ids` replaces the old single `section_id` and enrols the student into
    every listed subject class for the active semester in the same transaction, so the
    office can register a sixth-former and their whole subject load in one action.
    """

    model_config = ConfigDict(extra="forbid")
    student_number: str = Field(min_length=1, max_length=32)
    full_name: str = Field(min_length=1, max_length=160)
    date_of_birth: date
    gender: str | None = Field(default=None, max_length=40)
    year_group: str | None = Field(default=None, max_length=50)
    enrollment_date: date
    status: StudentStatus = StudentStatus.ACTIVE
    guardian_name: str | None = Field(default=None, max_length=160)
    guardian_phone: str | None = Field(default=None, max_length=40)
    guardian_email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=40)
    class_ids: list[UUID] = Field(default_factory=list)


class StudentUpdateRequest(BaseModel):
    """PATCH /students/{id} (api-spec §5.3, FR-STU-03).

    All fields optional (partial update). `status` is intentionally ABSENT — it is
    NOT editable here; lifecycle goes through the dedicated status endpoint
    (auditable, guarded). Class enrolment is likewise not a PATCH field — it is a
    Classes-module action (`POST /classes/{id}/enrollments`), and under D29 a student
    has many enrolments, so "set them from here" would be ambiguous about removals.
    """

    model_config = ConfigDict(extra="forbid")
    student_number: str | None = Field(default=None, min_length=1, max_length=32)
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=40)
    year_group: str | None = Field(default=None, max_length=50)
    enrollment_date: date | None = None
    guardian_name: str | None = Field(default=None, max_length=160)
    guardian_phone: str | None = Field(default=None, max_length=40)
    guardian_email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=40)


class StudentStatusRequest(BaseModel):
    """POST /students/{id}/status (api-spec §5.3, FR-STU-04)."""

    model_config = ConfigDict(extra="forbid")
    status: StudentStatus
    reason: str | None = Field(default=None, max_length=500)
