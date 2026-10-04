"""Reports schemas (api-spec §5 Module 10, FR-RPT-*, FR-TRN-*, schema §10.6).

Shapes mirror `frontend/src/features/reports/types.ts` exactly. Three of them are
reports-LOCAL on purpose and must not be swapped for the shared refs:

* `ReportSchool` uses `{name, address, phone, email, logo_url}`. The shared school
  read shape uses `contact_phone`/`contact_email`; the printed documents use the
  short names.
* `ReportCardSubjectRow.teacher` is a **plain display string**, not a `TeacherRef` —
  a report card prints a name, and the api-spec's `TeacherRef` would nest an object
  the print layout has no use for.
* `ReportStudentRef` is fatter than the shared `StudentRef`: it carries
  `date_of_birth`, `status` and the resolved section, because those head the printed
  document.

Read-only module: no write models.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.common.enums import ReportCardKind
from app.common.schemas import OfferingRef

GradeReportStatus = Literal["graded", "pending"]


class ReportStudentRef(BaseModel):
    """The student as printed on a report card / transcript / picker row.

    D29 replaced `section_id` / `section_name` / `grade_level` — all read off the
    student's homeroom — with `year_of_study`, which is the student's own level. A
    sixth-former has no single class whose name could head their report card.
    """

    id: UUID
    full_name: str
    student_number: str
    date_of_birth: date | None = None
    status: str
    year_of_study: str | None = None


class ReportSchool(BaseModel):
    """School identity as printed on a report card / transcript letterhead."""

    name: str
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None


class ReportSemesterRef(BaseModel):
    id: UUID
    name: str
    sequence: int
    academic_year_id: UUID
    academic_year_name: str = ""


class ReportSubjectRef(BaseModel):
    id: UUID
    name: str
    code: str = ""


class ReportAcademicYearRef(BaseModel):
    id: UUID
    name: str
    status: str


# ── GET /reports/students ──────────────────────────────────────────────────────
class StudentPickerPage(BaseModel):
    items: list[ReportStudentRef] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 25
    total_pages: int = 0


# ── GET /reports/report-card ───────────────────────────────────────────────────
class ReportCardSubjectRow(BaseModel):
    subject: ReportSubjectRef
    #: Display name only — see the module docstring. Printed as "Instructor" on the
    #: BAJC layout (D30 §D13).
    teacher: str | None = None
    #: The course's credit weight (D30 §D5). Printed, and the weight behind `ReportCard.gpa`.
    credits: int | None = None
    numeric: float | None = None
    letter: str | None = None
    status: GradeReportStatus = "graded"


class ReportAttendanceSummary(BaseModel):
    """Note this is NOT the attendance module's counts block: a report card prints
    `pct_present` plus the three exception tallies, and omits `present`."""

    pct_present: float = 0.0
    absent: int = 0
    late: int = 0
    excused: int = 0


class ReportCard(BaseModel):
    student: ReportStudentRef
    #: The student's level, e.g. "Lower 6". Replaces the old `section` block: under
    #: D29 a card covers every subject class the student sits, so there is no one
    #: class to name in the header.
    year_of_study: str | None = None
    semester: ReportSemesterRef
    school: ReportSchool
    #: The programme's CODE, e.g. `BMAD` — the BAJC layout's `Program` label (D30 §D13).
    #: `None` until a student is assigned a programme, which is Phase 4 §D12; today
    #: every `student_profiles.program_id` is NULL, so this prints blank rather than
    #: inventing a value.
    program_code: str | None = None
    #: `"<Term>, <Mon YYYY> - <Mon YYYY>"`, e.g. `Summer, July 2026 - August 2026`.
    #: The sample report card's `Period` label.
    period: str | None = None
    #: The layout's `Block` label. Always `None`: its meaning is unconfirmed with BAJC
    #: (plan §G item 3) and the sample prints `-`. An empty real field is honest;
    #: guessing what a block is would not be.
    block: str | None = None
    subjects: list[ReportCardSubjectRow] = Field(default_factory=list)
    attendance_summary: ReportAttendanceSummary
    term_average: float | None = None
    term_average_letter: str | None = None
    #: Credit-weighted GPA for the term (D30 §D5, decision #4): total quality points
    #: over **all enrolled credits**, with ungraded courses contributing 0 quality
    #: points and their full credits. `None` when no credits participated.
    #:
    #: Kept ALONGSIDE `term_average` rather than replacing it: the average is a 0-100
    #: percentage and the GPA is a 0-4 figure, they answer different questions, and the
    #: existing dashboards and gradebook screens read the average.
    gpa: float | None = None
    total_credits: int = 0
    #: True when the figures were read from `report_card_snapshots` /
    #: `term_grade_snapshots` rather than computed live (archived year, schema §10.4;
    #: D32: also every mid-term card, which is frozen by definition).
    is_frozen: bool = False
    #: D32 (brief §5) — which report this is.
    #:
    #: `midterm` is served VERBATIM from a `report_card_snapshots` payload and never
    #: recalculates; `endterm` keeps the existing compute-on-read behaviour for a live
    #: year and reads `term_grade_snapshots` once the year archives.
    report_kind: ReportCardKind = ReportCardKind.ENDTERM
    #: When a frozen card was captured. `None` on a computed one — a live card has no
    #: freeze moment, and printing "as of now" on it would be noise.
    frozen_at: datetime | None = None


# ── GET /reports/transcript ────────────────────────────────────────────────────
class TranscriptSubjectRow(BaseModel):
    subject: ReportSubjectRef
    teacher: str | None = None
    credits: int | None = None
    numeric: float | None = None
    #: Non-nullable here (unlike the report card) — the transcript only lists rows
    #: that actually resolved to a grade, OR carry a `notation` below.
    letter: str = ""
    #: D35 — the registry notation for a course with no grade: `AU` (audited) or `W`
    #: (withdrawn). `None` for an ordinary graded row.
    #:
    #: ⚠️ D45 §19 collapsed `W/P` + `W/F` into one `W`. The record no longer distinguishes
    #: a withdrawal-passing from a withdrawal-failing, and a transcript must not print a
    #: distinction the data cannot support.
    #:
    #: When this is set, `numeric` and `letter` are empty by definition and the row is
    #: excluded from the term average AND the GPA. It is printed anyway because that is
    #: the whole point of the client's `coursestatus`: a permanent record that silently
    #: omits the course a student withdrew from is not a transcript.
    notation: str | None = None


class TranscriptSemester(BaseModel):
    semester: ReportSemesterRef
    is_current: bool = False
    term_average: float | None = None
    #: Term GPA (D30 §D5). Weighted over **every** credit the student was enrolled in
    #: that term, INCLUDING courses whose rows are absent from `subjects` because they
    #: never resolved to a grade — the transcript lists graded lines only, but the GPA
    #: denominator is all enrolled credits (decision #4).
    gpa: float | None = None
    total_credits: int = 0
    subjects: list[TranscriptSubjectRow] = Field(default_factory=list)


class TranscriptYear(BaseModel):
    academic_year: ReportAcademicYearRef
    year_average: float | None = None
    #: Year GPA — recomputed over the year's own credits, NOT a mean of its terms'
    #: GPAs. Averaging GPAs would weight a 6-credit summer block the same as a
    #: 18-credit semester.
    gpa: float | None = None
    total_credits: int = 0
    semesters: list[TranscriptSemester] = Field(default_factory=list)


class Transcript(BaseModel):
    student: ReportStudentRef
    school: ReportSchool
    #: The programme the transcript is issued against — CODE and NAME (D39, Meeting #2
    #: item 7, "Add program in Transcript"). `ReportCard` has carried `program_code`
    #: since D30; the transcript never did, so the one document that leaves the building
    #: was the one that did not say what the student was reading for. A receiving
    #: institution needs the programme to interpret the courses at all.
    #:
    #: The NAME is sent alongside the code because a transcript is read by outsiders, to
    #: whom `BMAD` means nothing. Both are `None` for a student with no programme
    #: registration — printed blank rather than guessed, as `program_code` already is.
    program_code: str | None = None
    program_name: str | None = None
    issued_at: datetime
    years: list[TranscriptYear] = Field(default_factory=list)
    cumulative_average: float | None = None
    #: Cumulative GPA across every year — again recomputed from the underlying
    #: credits, not averaged from the per-year figures.
    cumulative_gpa: float | None = None
    total_credits: int = 0


# ── GET /reports/class-grades ──────────────────────────────────────────────────
class OfferingGradesStudentRow(BaseModel):
    student: ReportStudentRef
    numeric: float | None = None
    letter: str | None = None


class OfferingGradesDistributionItem(BaseModel):
    letter: str
    count: int = 0


class OfferingGradesReport(BaseModel):
    offering: OfferingRef
    semester: ReportSemesterRef | None = None
    students: list[OfferingGradesStudentRow] = Field(default_factory=list)
    class_average: float | None = None
    distribution: list[OfferingGradesDistributionItem] = Field(default_factory=list)


# ── GET /reports/attendance ────────────────────────────────────────────────────
class AttendanceReportSummary(BaseModel):
    present: int = 0
    absent: int = 0
    late: int = 0
    excused: int = 0
    pct_present: float = 0.0


class AttendanceReport(BaseModel):
    #: D31 dropped the `serialization_alias="class"` this carried for the mock. `class`
    #: was the right key while the subject was a homeroom; it is the wrong noun now, and
    #: keeping a Python-keyword alias to preserve it would outlive the reason for it.
    offering: OfferingRef
    semester: ReportSemesterRef | None = None
    summary: AttendanceReportSummary

    model_config = {"populate_by_name": True}


# ── GET /reports/enrollment ────────────────────────────────────────────────────
class EnrollmentTotals(BaseModel):
    students: int = 0
    offerings: int = 0


class EnrollmentByProgramme(BaseModel):
    """One row of the enrolment breakdown.

    D31 replaced `EnrollmentByGrade`, which grouped on `classes.grade_level` (`Form 1`..
    `Form 4`) — a homeroom column `008` dropped and a K-12 axis a junior college does
    not have. Programme is the tertiary equivalent, and it matches the dashboard tile
    (`_enrollment_by_programme`) so the two screens cannot disagree.

    Students with no programme are reported as one **"Not assigned"** row rather than
    dropped: until the Phase 5 seed lands that row is the whole college, and a report
    that silently omitted them would read as "no students".
    """

    programme: str
    count: int = 0


class EnrollmentByOffering(BaseModel):
    offering: OfferingRef
    enrolled: int = 0
    capacity: int | None = None


class EnrollmentReport(BaseModel):
    totals: EnrollmentTotals
    by_programme: list[EnrollmentByProgramme] = Field(default_factory=list)
    by_offering: list[EnrollmentByOffering] = Field(default_factory=list)


# ══════════════════════════════════════════════════════════════════════════════
# D45 Phase 9 — the four institutional reports of §53
#
# These four are DIFFERENT IN KIND from everything above. A report card and a
# transcript are documents ABOUT ONE STUDENT, printed and handed over. These are
# management reports about the COLLEGE — one row per programme, per offering or per
# student — read on screen by the Dean, the Registrar, the Auditor or a Head of
# Department to find the thing that needs attention.
#
# Every one of them therefore carries a `note`: a plain sentence saying what the
# numbers mean and what they deliberately do not. A management report whose
# definition lives only in a service docstring is a report two people will read two
# different ways in the same meeting.
# ══════════════════════════════════════════════════════════════════════════════
class ReportScope(BaseModel):
    """Who is looking, and how much of the college they were shown.

    A Head of Department sees their own programmes and nobody else's, and the report
    has to SAY so — an HOD reading "12 students below the attendance floor" must not
    take it for the college total. `programmes` is empty for an unscoped reader.
    """

    is_scoped: bool = False
    programmes: list[str] = Field(default_factory=list)


# ── GET /reports/new-vs-returning ─────────────────────────────────────────────
class NewVsReturningProgrammeRow(BaseModel):
    programme: str
    programme_code: str | None = None
    new: int = 0
    returning: int = 0
    total: int = 0


class NewVsReturningSemesterRow(BaseModel):
    """One term of the chosen year.

    ⚠️ `new` here is a DIFFERENT question from the year-level count: it means *this
    term is the first term this student has ever registered in*. A student who first
    registered in Semester 1 is `new` in that row and `returning` in Semester 2 — of
    the same year. Both readings are legitimate and BAJC uses both (intake for the
    year, intake for the term), so both are returned rather than one being picked.
    """

    semester: ReportSemesterRef
    new: int = 0
    returning: int = 0
    total: int = 0


class NewVsReturningStudentRow(BaseModel):
    student: ReportStudentRef
    programme: str | None = None
    is_new: bool = False
    #: The academic year the student FIRST registered in, whenever that was. For a new
    #: student this is the report's own year; for a returning one it is the evidence.
    first_registered_year: str | None = None


class NewVsReturningReport(BaseModel):
    academic_year: ReportAcademicYearRef
    generated_at: datetime
    new: int = 0
    returning: int = 0
    total: int = 0
    by_programme: list[NewVsReturningProgrammeRow] = Field(default_factory=list)
    by_semester: list[NewVsReturningSemesterRow] = Field(default_factory=list)
    students: list[NewVsReturningStudentRow] = Field(default_factory=list)
    scope: ReportScope = Field(default_factory=ReportScope)
    note: str


# ── GET /reports/overcapacity ─────────────────────────────────────────────────
#: Only the three bands a row can be RETURNED in. There is deliberately no "under":
#: classes with room to spare are counted in `OvercapacityReport.under_capacity` and not
#: listed, because listing them would turn an exceptions report into the enrolment report.
#: A wire enum carrying a value no response can ever hold is a value somebody writes a
#: branch for and never sees taken.
OvercapacityBand = Literal["over", "at", "unset"]


class OvercapacityRow(BaseModel):
    offering: OfferingRef
    lecturer: str | None = None
    capacity: int | None = None
    registered: int = 0
    #: `registered - capacity` when over, else 0. Sent rather than derived so the
    #: screen and the report cannot disagree about what "over by" means for a NULL
    #: capacity (it is 0, not the headcount).
    over_by: int = 0
    #: NULL when no capacity is set — a percentage of nothing is not 100%, it is
    #: unanswerable, and rendering it as 0% would put every unlimited class at the
    #: bottom of a list sorted by pressure.
    utilisation_pct: float | None = None
    band: OvercapacityBand = "unset"


class OvercapacityReport(BaseModel):
    semester: ReportSemesterRef
    generated_at: datetime
    #: The headline: offerings whose registered headcount EXCEEDS the seats set.
    over: list[OvercapacityRow] = Field(default_factory=list)
    #: Exactly full. Not a fault, but the next registration makes it one.
    at_capacity: list[OvercapacityRow] = Field(default_factory=list)
    #: Capacity never set. These CANNOT be over capacity — not because they have room,
    #: but because nobody said how much room they have. Shown, not hidden: an empty
    #: "over capacity" list means something quite different when half the college has
    #: no limit recorded.
    no_capacity_set: list[OvercapacityRow] = Field(default_factory=list)
    #: Counted, not listed — see `OvercapacityBand`.
    under_capacity: int = 0
    offerings_total: int = 0
    seats_total: int = 0
    registered_total: int = 0
    scope: ReportScope = Field(default_factory=ReportScope)
    note: str


# ── GET /reports/credit-load ──────────────────────────────────────────────────
class CreditLoadStudentRow(BaseModel):
    student: ReportStudentRef
    programme: str | None = None
    #: What the student DECLARED at admission ("Full Time" / "Part Time" / …). It is a
    #: statement of intent made once, not a fact about this term.
    declared_load: str | None = None
    courses: int = 0
    credits: int = 0
    #: Credits being AUDITED (D35). Carried in `credits` too, because an audited course
    #: is real workload, but split out because it earns nothing towards the award.
    audit_credits: int = 0
    #: Set only when the declared load and the actual credits contradict each other
    #: under BAJC's own application-form definition. NULL is the normal case.
    mismatch: str | None = None


class CreditLoadBand(BaseModel):
    credits: int
    students: int = 0


class CreditLoadByDeclared(BaseModel):
    declared_load: str
    students: int = 0
    min_credits: int = 0
    max_credits: int = 0
    avg_credits: float = 0.0
    mismatches: int = 0


class CreditLoadReport(BaseModel):
    semester: ReportSemesterRef
    generated_at: datetime
    students: int = 0
    credits_total: int = 0
    min_credits: int = 0
    max_credits: int = 0
    avg_credits: float = 0.0
    #: The threshold the mismatch column is measured against, echoed so the screen
    #: never hardcodes it and the reader can see what was applied.
    full_time_credits: int = 15
    mismatches: int = 0
    by_declared_load: list[CreditLoadByDeclared] = Field(default_factory=list)
    distribution: list[CreditLoadBand] = Field(default_factory=list)
    rows: list[CreditLoadStudentRow] = Field(default_factory=list)
    scope: ReportScope = Field(default_factory=ReportScope)
    note: str


# ── GET /reports/programme-attendance ─────────────────────────────────────────
class ProgrammeAttendanceRow(BaseModel):
    programme: str
    programme_code: str | None = None
    programme_id: UUID | None = None
    #: Students of this programme with AT LEAST ONE register taken this term — not the
    #: programme's headcount. A student nobody has marked contributes no percentage, and
    #: counting them in the denominator would silently dilute every figure here.
    students: int = 0
    records: int = 0
    present: int = 0
    absent: int = 0
    late: int = 0
    excused: int = 0
    pct_present: float = 0.0
    #: BELOW the school's configured floor (`attendance_alert_threshold`, D45 Phase 1),
    #: strictly — the same comparison `attendance/service.py::attendance_alerts` uses, so
    #: this report and the alerts screen cannot disagree about who is in trouble.
    #: NEVER true for a programme with no records — 0% of nothing is not a warning, it is
    #: a programme nobody has taken a register for.
    below_floor: bool = False
    students_below_floor: int = 0


class ProgrammeAttendanceStudentRow(BaseModel):
    student: ReportStudentRef
    records: int = 0
    present: int = 0
    absent: int = 0
    late: int = 0
    excused: int = 0
    pct_present: float = 0.0
    below_floor: bool = False


class ProgrammeAttendanceReport(BaseModel):
    semester: ReportSemesterRef
    generated_at: datetime
    #: The floor in force, from `school_profile.attendance_alert_threshold`.
    floor_pct: float = 80.0
    by_programme: list[ProgrammeAttendanceRow] = Field(default_factory=list)
    #: Per-student rows, present ONLY when one programme was asked for. A college-wide
    #: request returns the summary; drilling in is a second, narrower question.
    programme: ProgrammeAttendanceRow | None = None
    students: list[ProgrammeAttendanceStudentRow] = Field(default_factory=list)
    records_total: int = 0
    pct_present: float = 0.0
    scope: ReportScope = Field(default_factory=ReportScope)
    note: str
