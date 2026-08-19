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
    District,
    EnrollmentLoad,
    GradeStatus,
    StudentStatus,
    YearOfStudy,
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
    #: Computed from the parts by `StudentProfile.full_name` (D30 §D10) — the stored
    #: column was dropped in `007_student_names.sql`. Kept on the wire so the table,
    #: the picker and the print layouts did not all have to learn to assemble a name.
    full_name: str
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str
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
    #: See `StudentListItem.full_name` — computed, not stored.
    full_name: str
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str
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
    # ── Tertiary registration (D30 §D12, Phase 4) ─────────────────────────────
    #: The programme the student is CURRENTLY registered on. Written by acceptance
    #: (§D11) and by the Dean-only programme change (§D12) — never by `PATCH /students`,
    #: because changing it has to move `student_program_history` with it.
    program: ProgramRef | None = None
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None
    #: The application this student was admitted from, when there is one. Students who
    #: predate the admissions module — or who were created directly through
    #: `POST /students` — have none, and that stays supported.
    application_id: UUID | None = None
    district: District | None = None
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
    #: OPTIONAL since D30 (§D9, brief §10). Omit it and the server issues the next
    #: `YYYYMM###` for the current month. Supplying one is still accepted so an
    #: existing student can be imported under the number they already carry.
    student_number: str | None = Field(default=None, min_length=1, max_length=32)
    #: Split names (D30 §D10). Both required — the DB tolerates a missing given name
    #: only for legacy single-token rows, never for anything created here.
    first_name: str = Field(min_length=1, max_length=50)
    middle_name: str | None = Field(default=None, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
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
    first_name: str | None = Field(default=None, min_length=1, max_length=50)
    #: Explicitly nullable — clearing a middle name is a legitimate correction, so an
    #: empty string is normalised to NULL by the service rather than rejected.
    middle_name: str | None = Field(default=None, max_length=50)
    last_name: str | None = Field(default=None, min_length=1, max_length=50)
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


# ──────────────────────────────────────────────────────────────────────────────
# Programme registration + derived academic history (D30 §D12, brief §12/§27)
# ──────────────────────────────────────────────────────────────────────────────
class ProgramRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str = ""
    name: str = ""


class ProgramChangeRequest(BaseModel):
    """PUT /students/{id}/program — **DEAN ONLY** (§D12, §D14).

    Assigning a programme and moving between programmes are the same operation, because
    both have to keep `student_program_history` in step with
    `student_profiles.program_id`. A separate "assign" path would be a second writer of
    that pair and would eventually forget the history.
    """

    model_config = ConfigDict(extra="forbid")
    program_id: UUID
    #: Defaults to today. Overridable because a Dean often records a change days after the
    #: student actually moved, and the history should say when it happened rather than when
    #: it was typed. The outgoing programme is closed the day BEFORE this date, so the two
    #: registrations are contiguous with neither an overlap nor a gap.
    effective_from: date | None = None
    #: Why. Free text and optional — the Dean records a reason when there is one, and a
    #: missing one must not block a correction.
    reason: str | None = Field(default=None, max_length=255)
    #: Optional: a programme change is often a year/load change too, and making the Dean
    #: issue a second PATCH for it would leave a window where the record disagrees.
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None


class ProgramHistoryEntry(BaseModel):
    """One registration period. `ended_at is None` means CURRENT."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    program: ProgramRef
    started_at: date
    ended_at: date | None = None
    reason: str | None = None
    is_current: bool = False


class StudentProgramRef(BaseModel):
    """200 body of the programme change — the new state plus the whole history.

    The history comes back with it deliberately: the point of §D12 is that a change does
    not destroy the past, and returning it is what lets the screen show that immediately
    rather than after a second fetch.
    """

    student_id: UUID
    program: ProgramRef | None = None
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None
    history: list[ProgramHistoryEntry] = Field(default_factory=list)


class AcademicHistoryCourse(BaseModel):
    """One course in the student's record, in exactly one bucket.

    `status`:
      * `transferred`  — granted by an approved credit transfer. Counts toward the award,
                         EXCLUDED from the GPA (a transfer grants credit, not a grade).
      * `completed`    — a result clearing the student's PROGRAMME pass mark (§D5).
      * `failed`       — a result below it. Counted in the GPA; still owed.
      * `in_progress`  — enrolled, nothing marked yet.
      * `remaining`    — in the programme curriculum, never taken.
    """

    course_id: UUID
    code: str = ""
    name: str = ""
    credits: int | None = None
    #: Curriculum POSITION in the programme plan ("Semester 1", "Spring 2"), not a dated
    #: term — the §D3 distinction. `None` for a course the plan does not contain.
    term_label: str | None = None
    term_order: int | None = None
    is_required: bool = False
    #: False for a course the student took that the CURRENT programme does not list. After
    #: a programme change that is the honest reading of work which no longer counts toward
    #: the award — the grade is untouched, it simply stops being a requirement.
    in_curriculum: bool = False
    status: str
    numeric: float | None = None
    letter: str | None = None
    grade_point: float | None = None
    #: True when the result came from a frozen `term_grade_snapshots` row (archived year).
    is_frozen: bool = False
    semester_id: UUID | None = None


class AcademicHistoryCounts(BaseModel):
    completed: int = 0
    failed: int = 0
    in_progress: int = 0
    transferred: int = 0
    remaining: int = 0


class AcademicHistory(BaseModel):
    """GET /students/{id}/academic-history — **entirely derived** (§D12, brief §27).

    Nothing here is stored. It is recomputed from `class_enrollments` +
    `term_grade_snapshots` + approved `credit_transfer_requests` + `program_courses` on
    every read, so a corrected grade or a re-priced band shows up immediately instead of
    leaving a cached figure to drift.
    """

    student_id: UUID
    full_name: str
    student_number: str
    program: ProgramRef | None = None
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None
    #: The credit total PRINTED on the programme's sequence (86–102).
    program_total_credits: int | None = None
    #: Summed from the curriculum rows marked required. Compared against the printed total
    #: by the UI, because the two disagreeing is how a data-entry slip gets noticed.
    curriculum_required_credits: int = 0
    #: Passed + transferred credits.
    credits_earned: int = 0
    #: Required curriculum credits not yet earned. Electives the student chose not to take
    #: are not outstanding requirements, so this is against the REQUIRED plan only.
    credits_remaining: int = 0
    #: Cumulative, from the single `calc.compute_gpa` (§D5, decision #4). Weighted over
    #: every ENROLLED credit — a course with no result yet keeps its credits and earns no
    #: quality points. Transferred courses are excluded entirely.
    gpa: float | None = None
    gpa_total_credits: int = 0
    counts: AcademicHistoryCounts
    #: Plan order first, then code — so the screen reads down the programme sequence and
    #: anything outside the plan falls to the end.
    courses: list[AcademicHistoryCourse] = Field(default_factory=list)
    program_history: list[ProgramHistoryEntry] = Field(default_factory=list)
    active_semester_id: UUID | None = None
