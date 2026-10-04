"""Attendance request/response schemas (api-spec §5 Module 8, FR-ATT-*).

Write models set `extra="forbid"` (§1.4); wire is snake_case (§1.2). Read shapes
are reconciled to the finished frontend MSW handler + types
(`handlers/attendance.ts`, `features/attendance/types.ts`), which WIN on divergence:

  * offering ref    = {offering: OfferingRef, teachers[]}   (D31 — was a flat
      `{id, name, grade_level, section, homeroom_label, teachers[]}` homeroom ref)
    - `teachers[]` items use the key **`name`** (NOT `full_name`). This differs on
      purpose from the Grades module's teacher ref; the attendance screens read
      `t.name` and the two modules were built in parallel.
  * register entry  = {student:{id,full_name,student_number}, enrollment_id,
                       status|null, recorded_at|null}
    - `status is null` means "not yet recorded for this day" (the UI defaults the
      row to present); it is NOT an attendance value.
  * last_recorded   = {by: <NAME STRING>, at: <datetime>} | null — `by` is a plain
      name string, not a user ref object.
  * counts block    = {present, absent, late, excused, pct_present}; `pct_present`
      counts LATE as present and is rounded to one decimal (see service._summarize).

Column mapping note (the live `attendance_records` table has no recorded_* / notes
columns): `recorded_at` ← `updated_at`, and `last_recorded.by` ← `updated_by`
resolved to `users.full_name` (falling back to `created_by`, then "Staff").
"""

from __future__ import annotations

from datetime import date as _date
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import AttendanceStatus
from app.common.schemas import OfferingRef


# ── Refs (frontend shape) ──────────────────────────────────────────────────────
class AttendanceTeacherRef(BaseModel):
    """A lecturer assigned to the offering. Key is `name` (binding)."""

    id: UUID
    name: str


class AttendanceOfferingRef(BaseModel):
    """The shared `OfferingRef`, plus who staffs it.

    D31 replaced a flat homeroom ref (`name`, `grade_level`, `section`,
    `homeroom_label`) that read four columns `course_offerings` no longer has. The
    offering half now comes from `offerings.labels.offering_ref` — the single builder —
    so this module cannot drift from Grades or Reports about how an offering is named.

    `teachers` stays OUTSIDE the shared ref on purpose: who teaches an offering is an
    attendance concern (the register names them), not part of identifying the offering.
    """

    offering: OfferingRef
    teachers: list[AttendanceTeacherRef] = Field(default_factory=list)


class AttendanceStudentRef(BaseModel):
    id: UUID
    full_name: str
    student_number: str


class AttendanceCounts(BaseModel):
    """P/A/L/E tally + `pct_present` (late counts as present, one decimal)."""

    present: int = 0
    absent: int = 0
    late: int = 0
    excused: int = 0
    pct_present: float = 0.0


# ── GET /attendance/offerings ───────────────────────────────────────────────────
class AttendanceOfferingPickerItem(AttendanceOfferingRef):
    enrolled_count: int = 0


class AttendanceOfferingsResponse(BaseModel):
    items: list[AttendanceOfferingPickerItem] = Field(default_factory=list)
    can_record: bool = False


# ── GET /attendance (the daily register) ───────────────────────────────────────
class AttendanceEntry(BaseModel):
    student: AttendanceStudentRef
    enrollment_id: UUID | None = None
    status: AttendanceStatus | None = None
    recorded_at: datetime | None = None


class LastRecorded(BaseModel):
    by: str
    at: datetime


class AttendanceRegister(BaseModel):
    offering: AttendanceOfferingRef
    date: _date
    can_record: bool = False
    entries: list[AttendanceEntry] = Field(default_factory=list)
    last_recorded: LastRecorded | None = None


# ── PUT /attendance ────────────────────────────────────────────────────────────
class AttendanceUpsertEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_id: UUID
    status: AttendanceStatus


class AttendanceUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offering_id: UUID
    date: _date
    entries: list[AttendanceUpsertEntry] = Field(default_factory=list)


class AttendanceUpsertResponse(BaseModel):
    upserted: int = 0
    summary: AttendanceCounts


# ── GET /attendance/summary ────────────────────────────────────────────────────
class AttendanceDatePoint(AttendanceCounts):
    date: _date


class AttendanceStudentPoint(AttendanceCounts):
    student: AttendanceStudentRef


class AttendanceSummaryResponse(BaseModel):
    offering: AttendanceOfferingRef
    overall: AttendanceCounts
    by_date: list[AttendanceDatePoint] = Field(default_factory=list)
    by_student: list[AttendanceStudentPoint] = Field(default_factory=list)


# ── GET /attendance/me ─────────────────────────────────────────────────────────
class MyAttendanceHistoryItem(BaseModel):
    date: _date
    status: AttendanceStatus


class MyAttendanceResponse(BaseModel):
    summary: AttendanceCounts
    history: list[MyAttendanceHistoryItem] = Field(default_factory=list)


# ── GET /attendance/alerts (D44) ───────────────────────────────────────────────
class AttendanceAlertOffering(AttendanceCounts):
    """One class whose overall attendance has fallen below the threshold."""

    offering: AttendanceOfferingRef
    #: Enrolled students, so a 50% built from two marked days is visibly not a crisis.
    enrolled_count: int = 0
    #: `present + absent + late + excused` — the DENOMINATOR the percentage came from.
    #: Surfaced because it is the single most important caveat about that number: see
    #: `service.get_alerts`.
    sessions_recorded: int = 0


class AttendanceAlertStudent(AttendanceCounts):
    """One student below the threshold, in one class.

    Per (student, offering) rather than per student: a student can be diligent in three
    courses and absent from a fourth, and an average across all four would hide exactly
    the case the alert exists to surface.
    """

    student: AttendanceStudentRef
    offering: AttendanceOfferingRef
    sessions_recorded: int = 0


class AttendanceAlertsResponse(BaseModel):
    """Everything below the threshold for one academic year.

    Both lists are ordered worst-first — the point of an alert list is the top of it.
    """

    #: The percentage the two lists were filtered on. Echoed back so the UI states the
    #: rule it is showing rather than hard-coding a second copy of the number.
    threshold: float
    #: NULL when the school has no active year and none was asked for; both lists are
    #: then empty and the UI can say so rather than showing a clean bill of health.
    academic_year_id: UUID | None = None
    offerings: list[AttendanceAlertOffering] = Field(default_factory=list)
    students: list[AttendanceAlertStudent] = Field(default_factory=list)
