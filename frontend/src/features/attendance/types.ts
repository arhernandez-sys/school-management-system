/**
 * Attendance module types.
 *
 * These mirror `backend/app/modules/attendance/schemas.py` and the demo MSW handler
 * (handlers/attendance.ts). Attendance is per-OFFERING, per-day (D-Q4): for an
 * (offering, date) each actively enrolled student has a present/absent/late/excused
 * status. Wire format is snake_case.
 *
 * **D31** — `AttendanceSectionRef` is gone. It was a "fat" homeroom ref carrying `name`,
 * `grade_level`, the division letter and `homeroom_label` — four columns that no longer
 * exist. The register now nests the SHARED `OfferingRef` beside the local `teachers[]`,
 * which is the split the whole refactor settled on: the identity is shared so every screen
 * names it identically, and only genuinely module-local data stays local.
 *
 * `teachers[].name` is that local half. Note it is `name`, NOT the shared ref's
 * `full_name`: this is the attendance picker's own filter feed, and the backend serves it
 * under `name`. Renaming it here would make the type lie about the wire.
 */
import type { OfferingRef } from '@shared/types/api';
import type { AttendanceStatus } from '@shared/types/enums';

export type { AttendanceStatus, OfferingRef };

/** The attendance module's local teacher shape — keyed `name`, not `full_name`. */
export interface AttendanceTeacherRef {
  id: string;
  name: string;
}

/** An offering as surfaced by the attendance picker / register. */
export interface AttendanceOfferingRef {
  offering: OfferingRef;
  /** Lecturers who teach it — drives the Dean/Registrar lecturer filter. */
  teachers: AttendanceTeacherRef[];
}

/** Picker payload: offerings the caller may view/record + whether they can record. */
export interface AttendanceOfferingsResponse {
  items: Array<AttendanceOfferingRef & { enrolled_count: number }>;
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

/** GET /attendance — the daily register for one (offering, date). */
export interface AttendanceRegister {
  offering: AttendanceOfferingRef;
  date: string;
  can_record: boolean;
  entries: AttendanceEntry[];
  last_recorded: { by: string; at: string } | null;
}

/** Request body for PUT /attendance (bulk upsert). */
export interface AttendanceUpsertRequest {
  offering_id: string;
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

/** One student's present/absent/late/excused tally over the summary window. */
export type PerStudentAttendance = { student: AttendanceStudentRef } & AttendanceCounts;

/** GET /attendance/summary — per-offering rate over the seeded window. */
export interface AttendanceSummaryResponse {
  offering: AttendanceOfferingRef;
  overall: AttendanceCounts;
  by_date: Array<{ date: string } & AttendanceCounts>;
  /** Per-student tallies for every actively enrolled student in the offering. */
  by_student: PerStudentAttendance[];
}

/**
 * The attendance floor, as a percentage (D44). Mirrors
 * `attendance/service.ATTENDANCE_ALERT_THRESHOLD`.
 *
 * Used only as the DEFAULT for the request. Everything rendered reads
 * `AttendanceAlertsResponse.threshold`, which the server echoes back — so the screen
 * states the rule the server applied rather than a second copy of the number that can
 * disagree with it.
 */
export const ATTENDANCE_ALERT_THRESHOLD = 80;

/**
 * One class below the floor.
 *
 * ⚠️ `sessions_recorded` is the DENOMINATOR the percentage came from, and it is not
 * optional decoration. The server counts records WRITTEN, not sessions scheduled: a class
 * whose register has been marked twice, with one absence, reads 50% and is not in trouble.
 * Every surface that shows the percentage must show this next to it.
 */
export type AttendanceAlertOffering = {
  offering: AttendanceOfferingRef;
  enrolled_count: number;
  sessions_recorded: number;
} & AttendanceCounts;

/** One student below the floor, IN ONE CLASS — not averaged across their courses. */
export type AttendanceAlertStudent = {
  student: AttendanceStudentRef;
  offering: AttendanceOfferingRef;
  sessions_recorded: number;
} & AttendanceCounts;

/** GET /attendance/alerts — everything below the floor for one academic year. */
export interface AttendanceAlertsResponse {
  /** Echoed back by the server; render this, not the constant. */
  threshold: number;
  /** Null when the school has no active year — both lists are then empty for that reason. */
  academic_year_id: string | null;
  /** Worst first. */
  offerings: AttendanceAlertOffering[];
  /** Worst first. */
  students: AttendanceAlertStudent[];
}

/** GET /attendance/me — a student's own attendance. */
export interface MyAttendanceResponse {
  summary: AttendanceCounts;
  history: Array<{ date: string; status: AttendanceStatus }>;
}
