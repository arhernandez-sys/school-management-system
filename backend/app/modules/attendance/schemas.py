"""Attendance request/response schemas (api-spec §5 Module 8, FR-ATT-*).

Write models set `extra="forbid"` (§1.4); wire is snake_case (§1.2). Read shapes
are reconciled to the finished frontend MSW handler + types
(`handlers/attendance.ts`, `features/attendance/types.ts`), which WIN on divergence:

  * section ref     = {id, name, grade_level, section, homeroom_label, teachers[]}
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


# ── Refs (frontend shape) ──────────────────────────────────────────────────────
class AttendanceTeacherRef(BaseModel):
    """A teacher who teaches any subject in the section. Key is `name` (binding)."""

    id: UUID
    name: str


class AttendanceSectionRef(BaseModel):
    """`section` and `homeroom_label` are nullable columns but non-nullable
    `string` in `features/attendance/types.ts`, so the service coerces `None` → ""
    rather than emitting a null the screens would render as "null"."""

    id: UUID
    name: str
    grade_level: str
    section: str = ""
    homeroom_label: str = ""
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


# ── GET /attendance/sections ───────────────────────────────────────────────────
class AttendanceSectionPickerItem(AttendanceSectionRef):
    enrolled_count: int = 0


class AttendanceSectionsResponse(BaseModel):
    items: list[AttendanceSectionPickerItem] = Field(default_factory=list)
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
    section: AttendanceSectionRef
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
    section_id: UUID
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
    section: AttendanceSectionRef
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
