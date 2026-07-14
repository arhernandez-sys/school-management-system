import { http, HttpResponse, type RequestHandler } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY,
  DEMO_IDS,
  attendanceFor,
  rosterFor,
  getSection,
  getStudent,
  getTeacher,
  activeEnrollmentFor,
  sectionsOwnedByTeacher,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAttendanceRecord,
  DemoSection,
  DemoStudent,
} from '@shared/api/mocks/demo/dataset';
import type { AttendanceStatus } from '@shared/types/enums';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for the ATTENDANCE module (api-spec §5 Module 8) — DEMO.
 *
 * Attendance is per-section, per-day (D-Q4): for a (section, date) each actively
 * enrolled student is present/absent/late/excused. These handlers back the tablet-first
 * daily register, the per-section 2-week summary, and the student's own read.
 *
 * Reads/writes go through the shared demo dataset so numbers reconcile with every other
 * screen. `PUT /attendance` MUTATES `DEMO_DATASET.attendance_records` (single-session
 * demo — intended). All wire fields are snake_case.
 *
 * Endpoints (demo-shaped, section+date query form):
 *  - GET  /attendance/sections      → sections the caller may view/record (picker)
 *  - GET  /attendance?section_id=&date=  → the daily register (roster + each status)
 *  - PUT  /attendance               → bulk upsert the register for one (section, date)
 *  - GET  /attendance/summary?section_id=  → per-section rate over the seeded window
 *  - GET  /attendance/me            → the signed-in student's own summary + history
 *
 * DEMO caller resolution: the mock login (fixtures.ts) issues placeholder profile ids
 * that do not map to dataset rows, so we resolve the acting teacher/student from the
 * `sis_mock_session` role cookie — the same approach settings.ts uses. A teacher maps to
 * the canonical demo teacher `teach-1` (Maria Reyes, who owns sections and recorded the
 * seeded register); a student maps to `stu-1` (Ana Lopez). P/S may view any section.
 *
 * ⚠️ Do NOT touch handlers/index.ts — `attendanceHandlers` is already wired.
 */
const D = DEMO_DATASET;

const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
const isAttendanceStatus = (v: unknown): v is AttendanceStatus =>
  typeof v === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(v);

/** Read the demo session role from the (non-HttpOnly) marker cookie; default principal. */
function sessionRole(cookies: Record<string, string>): string {
  return cookies['sis_mock_session'] ?? 'principal';
}

/** The teacher the demo acts as when the session role is `teacher` (canonical: teach-1). */
function actingTeacherId(): string {
  return getTeacher('teach-1')?.id ?? D.teachers.find((t) => t.status === 'active')!.id;
}

/** The student the demo acts as for `/attendance/me` (canonical: stu-1 = Ana Lopez). */
function actingStudentId(): string {
  return getStudent('stu-1')?.id ?? D.students.find((s) => s.status === 'active')!.id;
}

/** Sections the caller may view/record for. Teacher → owned; P/S → all non-archived. */
function sectionsForRole(role: string): DemoSection[] {
  if (role === 'teacher') return sectionsOwnedByTeacher(actingTeacherId());
  return D.sections.filter((s) => !s.is_archived);
}

/** Can the caller access this section at all? (used to 404 cross-section teacher access) */
function canAccessSection(role: string, sectionId: string): boolean {
  return sectionsForRole(role).some((s) => s.id === sectionId);
}

// ── Wire shapes ────────────────────────────────────────────────────────────────
function sectionRef(sec: DemoSection) {
  return { id: sec.id, name: sec.name, grade_level: sec.grade_level, homeroom_label: sec.homeroom_label };
}
function studentRef(stu: DemoStudent) {
  return { id: stu.id, full_name: stu.full_name, student_number: stu.student_number };
}

/** Count a set of records by status into the P/A/L/E summary block. */
function summarize(records: Array<{ status: AttendanceStatus }>) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of records) counts[r.status] += 1;
  const total = records.length;
  const pct_present =
    total === 0 ? 0 : Math.round(((counts.present + counts.late) / total) * 1000) / 10;
  return { ...counts, pct_present };
}

export const attendanceHandlers: RequestHandler[] = [
  // ── Section picker ──────────────────────────────────────────────────────────────
  // GET /attendance/sections — the sections the caller may pick (teacher: own; P/S: all).
  http.get(`${API_BASE_URL}/attendance/sections`, ({ cookies }) => {
    const role = sessionRole(cookies);
    const canRecord = role === 'teacher';
    return HttpResponse.json({
      items: sectionsForRole(role).map((s) => ({
        ...sectionRef(s),
        enrolled_count: rosterFor(s.id).length,
      })),
      can_record: canRecord,
    });
  }),

  // ── Daily register read ───────────────────────────────────────────────────────
  // GET /attendance?section_id=&date= — roster ∪ any recorded status for the day.
  http.get(`${API_BASE_URL}/attendance`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const sectionId = url.searchParams.get('section_id');
    const date = url.searchParams.get('date') ?? DEMO_TODAY;
    const role = sessionRole(cookies);

    if (!sectionId) return errorResponse(422, 'validation_error', 'section_id is required.');
    const section = getSection(sectionId);
    if (!section || !canAccessSection(role, sectionId)) {
      return errorResponse(404, 'not_found', 'Section not found.');
    }

    const recorded = attendanceFor(sectionId, date);
    const byStudent = new Map(recorded.map((r) => [r.student_id, r]));
    const roster = rosterFor(sectionId);

    const entries = roster.map((stu) => {
      const rec = byStudent.get(stu.id);
      const enr = activeEnrollmentFor(stu.id, sectionId);
      return {
        student: studentRef(stu),
        enrollment_id: enr?.id ?? null,
        status: rec?.status ?? null, // null = not yet recorded (UI defaults to present)
        recorded_at: rec?.recorded_at ?? null,
      };
    });

    // "Last recorded by … on …" (FR-ATT-04) from the most recent stamp for the day.
    const lastStamp = recorded
      .map((r) => r.recorded_at)
      .sort()
      .at(-1);
    const lastRec = recorded.find((r) => r.recorded_at === lastStamp);
    const lastUser = lastRec ? D.users.find((u) => u.id === lastRec.recorded_by_user_id) : undefined;

    return HttpResponse.json({
      section: sectionRef(section),
      date,
      can_record: role === 'teacher',
      entries,
      last_recorded: lastRec
        ? { by: lastUser?.full_name ?? 'Staff', at: lastRec.recorded_at }
        : null,
    });
  }),

  // ── Bulk upsert the register ────────────────────────────────────────────────────
  // PUT /attendance — upsert on (section_id, student_id, date). Blocks future dates.
  http.put(`${API_BASE_URL}/attendance`, async ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'teacher') {
      return errorResponse(403, 'forbidden', 'Only a class teacher can record attendance.');
    }

    const body = (await request.json()) as {
      section_id?: string;
      date?: string;
      entries?: Array<{ student_id?: string; status?: string }>;
    };
    const sectionId = body.section_id;
    const date = body.date;

    if (!sectionId || !date) {
      return errorResponse(422, 'validation_error', 'section_id and date are required.');
    }
    const section = getSection(sectionId);
    if (!section || !canAccessSection(role, sectionId)) {
      return errorResponse(404, 'not_found', 'Section not found.');
    }
    // FR-ATT-05: no future dates (server clock == DEMO_TODAY in the demo).
    if (date > DEMO_TODAY) {
      return errorResponse(422, 'future_date_not_allowed', "You can't record attendance for a future date.");
    }

    const rosterIds = new Set(rosterFor(sectionId).map((s) => s.id));
    const recordedBy = getTeacher(actingTeacherId())?.user_id ?? DEMO_IDS.principalUserId;
    const recordedAt = `${date}T08:15:00Z`;

    let upserted = 0;
    for (const entry of body.entries ?? []) {
      if (!entry.student_id || !isAttendanceStatus(entry.status)) continue;
      // Each student must be actively enrolled in the section for the semester.
      if (!rosterIds.has(entry.student_id)) continue;
      const enr = activeEnrollmentFor(entry.student_id, sectionId);
      if (!enr) continue;

      const existing = D.attendance_records.find(
        (r) => r.section_id === sectionId && r.student_id === entry.student_id && r.attendance_date === date,
      );
      if (existing) {
        existing.status = entry.status;
        existing.recorded_by_user_id = recordedBy;
        existing.recorded_at = recordedAt;
      } else {
        const created: DemoAttendanceRecord = {
          id: `att-new-${D.attendance_records.length + 1}`,
          section_id: sectionId,
          student_id: entry.student_id,
          enrollment_id: enr.id,
          semester_id: DEMO_IDS.activeSemesterId,
          attendance_date: date,
          status: entry.status,
          recorded_by_user_id: recordedBy,
          recorded_at: recordedAt,
        };
        D.attendance_records.push(created);
      }
      upserted += 1;
    }

    const dayRecords = attendanceFor(sectionId, date);
    return HttpResponse.json({ upserted, summary: summarize(dayRecords) });
  }),

  // ── Per-section summary (history/trend over the seeded window) ──────────────────
  // GET /attendance/summary?section_id= — daily rate points + overall counts.
  http.get(`${API_BASE_URL}/attendance/summary`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const sectionId = url.searchParams.get('section_id');
    const role = sessionRole(cookies);

    if (!sectionId) return errorResponse(422, 'validation_error', 'section_id is required.');
    const section = getSection(sectionId);
    if (!section || !canAccessSection(role, sectionId)) {
      return errorResponse(404, 'not_found', 'Section not found.');
    }

    const rows = D.attendance_records.filter((r) => r.section_id === sectionId);
    const dates = [...new Set(rows.map((r) => r.attendance_date))].sort();
    const by_date = dates.map((date) => {
      const dayRows = rows.filter((r) => r.attendance_date === date);
      return { date, ...summarize(dayRows) };
    });

    return HttpResponse.json({
      section: sectionRef(section),
      overall: summarize(rows),
      by_date,
    });
  }),

  // ── Student's own attendance (FR-ATT-07) ────────────────────────────────────────
  // GET /attendance/me — summary + history for the signed-in student (self only).
  http.get(`${API_BASE_URL}/attendance/me`, ({ cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'student') {
      return errorResponse(403, 'forbidden', 'Only a student can view their own attendance.');
    }
    const studentId = actingStudentId();
    const rows = D.attendance_records
      .filter((r) => r.student_id === studentId)
      .sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));

    return HttpResponse.json({
      summary: summarize(rows),
      history: rows.map((r) => ({ date: r.attendance_date, status: r.status })),
    });
  }),
];
