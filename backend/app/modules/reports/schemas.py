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

GradeReportStatus = Literal["graded", "pending"]


class ReportStudentRef(BaseModel):
    id: UUID
    full_name: str
    student_number: str
    date_of_birth: date | None = None
    status: str
    section_id: UUID | None = None
    section_name: str | None = None
    grade_level: str | None = None


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


class ReportSectionRef(BaseModel):
    id: UUID
    name: str
    grade_level: str


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
    #: Display name only — see the module docstring.
    teacher: str | None = None
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
    section: ReportSectionRef | None = None
    semester: ReportSemesterRef
    school: ReportSchool
    subjects: list[ReportCardSubjectRow] = Field(default_factory=list)
    attendance_summary: ReportAttendanceSummary
    term_average: float | None = None
    term_average_letter: str | None = None
    #: True when the figures were read from `report_card_snapshots` /
    #: `term_grade_snapshots` rather than computed live (archived year, schema §10.4).
    is_frozen: bool = False


# ── GET /reports/transcript ────────────────────────────────────────────────────
class TranscriptSubjectRow(BaseModel):
    subject: ReportSubjectRef
    teacher: str | None = None
    numeric: float | None = None
    #: Non-nullable here (unlike the report card) — the transcript only lists rows
    #: that actually resolved to a grade.
    letter: str = ""


class TranscriptSemester(BaseModel):
    semester: ReportSemesterRef
    is_current: bool = False
    term_average: float | None = None
    subjects: list[TranscriptSubjectRow] = Field(default_factory=list)


class TranscriptYear(BaseModel):
    academic_year: ReportAcademicYearRef
    year_average: float | None = None
    semesters: list[TranscriptSemester] = Field(default_factory=list)


class Transcript(BaseModel):
    student: ReportStudentRef
    school: ReportSchool
    issued_at: datetime
    years: list[TranscriptYear] = Field(default_factory=list)
    cumulative_average: float | None = None


# ── GET /reports/class-grades ──────────────────────────────────────────────────
class ClassGradesStudentRow(BaseModel):
    student: ReportStudentRef
    numeric: float | None = None
    letter: str | None = None


class ClassGradesClassSubjectRef(BaseModel):
    id: UUID
    section_id: UUID
    section_name: str = ""
    subject_name: str = ""


class ClassGradesDistributionItem(BaseModel):
    letter: str
    count: int = 0


class ClassGradesReport(BaseModel):
    class_subject: ClassGradesClassSubjectRef
    semester: ReportSemesterRef | None = None
    students: list[ClassGradesStudentRow] = Field(default_factory=list)
    class_average: float | None = None
    distribution: list[ClassGradesDistributionItem] = Field(default_factory=list)


# ── GET /reports/attendance ────────────────────────────────────────────────────
class AttendanceReportSummary(BaseModel):
    present: int = 0
    absent: int = 0
    late: int = 0
    excused: int = 0
    pct_present: float = 0.0


class AttendanceReport(BaseModel):
    #: Key is `class`, matching the mock. Aliased because `class` is a Python keyword.
    section: ReportSectionRef = Field(serialization_alias="class")
    semester: ReportSemesterRef | None = None
    summary: AttendanceReportSummary

    model_config = {"populate_by_name": True}


# ── GET /reports/enrollment ────────────────────────────────────────────────────
class EnrollmentTotals(BaseModel):
    students: int = 0
    classes: int = 0


class EnrollmentByGrade(BaseModel):
    grade_level: str
    count: int = 0


class EnrollmentByClass(BaseModel):
    class_ref: ReportSectionRef
    enrolled: int = 0
    capacity: int | None = None


class EnrollmentReport(BaseModel):
    totals: EnrollmentTotals
    by_grade: list[EnrollmentByGrade] = Field(default_factory=list)
    by_class: list[EnrollmentByClass] = Field(default_factory=list)
