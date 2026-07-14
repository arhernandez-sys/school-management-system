/**
 * Attendance module types (Phase 7 — client demo).
 *
 * These mirror the demo MSW handler wire shapes (handlers/attendance.ts). Attendance is
 * per-section, per-day (D-Q4): for a (section, date) each actively enrolled student has a
 * present/absent/late/excused status. Wire format is snake_case.
 */
import type { AttendanceStatus } from '@shared/types/enums';

export type { AttendanceStatus };

/** A section as surfaced by the attendance picker / register. */
export interface AttendanceSectionRef {
  id: string;
  name: string;
  grade_level: string;
  homeroom_label: string;
}

/** Picker payload: sections the caller may view/record + whether they can record. */
export interface AttendanceSectionsResponse {
  items: Array<AttendanceSectionRef & { enrolled_count: number }>;
  can_record: boolean;
}

export interface AttendanceStudentRef {
  id: string;
  full_name: string;
  student_number: string;
}

/** One row of the daily register. `status === null` = not yet recorded. */
export interface AttendanceEntry {
  student: AttendanceStudentRef;
  enrollment_id: string | null;
  status: AttendanceStatus | null;
  recorded_at: string | null;
}

/** GET /attendance — the daily register for one (section, date). */
export interface AttendanceRegister {
  section: AttendanceSectionRef;
  date: string;
  can_record: boolean;
  entries: AttendanceEntry[];
  last_recorded: { by: string; at: string } | null;
}

/** Request body for PUT /attendance (bulk upsert). */
export interface AttendanceUpsertRequest {
  section_id: string;
  date: string;
  entries: Array<{ student_id: string; status: AttendanceStatus }>;
}

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  pct_present: number;
}

/** Response of PUT /attendance. */
export interface AttendanceUpsertResponse {
  upserted: number;
  summary: Omit<AttendanceCounts, 'pct_present'>;
}

/** GET /attendance/summary — per-section rate over the seeded window. */
export interface AttendanceSummaryResponse {
  section: AttendanceSectionRef;
  overall: AttendanceCounts;
  by_date: Array<{ date: string } & AttendanceCounts>;
}

/** GET /attendance/me — a student's own attendance. */
export interface MyAttendanceResponse {
  summary: AttendanceCounts;
  history: Array<{ date: string; status: AttendanceStatus }>;
}
