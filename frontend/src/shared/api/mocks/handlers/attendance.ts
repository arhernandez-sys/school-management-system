import { http, HttpResponse, type RequestHandler } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY,
  DEMO_IDS,
  attendanceFor,
  rosterFor,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  getTeacher,
  activeEnrollmentFor,
  offeringLabel,
  offeringsOwnedByTeacher,
  yearIdOfOffering,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAttendanceRecord,
  DemoOffering,
  DemoStudent,
} from '@shared/api/mocks/demo/dataset';
import type { AttendanceStatus } from '@shared/types/enums';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for the ATTENDANCE module (api-spec §5 Module 8) — DEMO.
 *
 * Attendance is per-OFFERING, per-day (D-Q4): for an (offering, date) each actively
 * enrolled student is present/absent/late/excused. These handlers back the tablet-first
 * daily register, the per-offering 2-week summary, and the student's own read.
 *
 * Reads/writes go through the shared demo dataset so numbers reconcile with every other
 * screen. `PUT /attendance` MUTATES `DEMO_DATASET.attendance_records` (single-session
 * demo — intended). All wire fields are snake_case.
 *
 * Endpoints (offering+date query form):
 *  - GET  /attendance/offerings      → offerings the caller may view/record (picker)
 *  - GET  /attendance?offering_id=&date= → the daily register (roster + each status)
 *  - PUT  /attendance                → bulk upsert the register for one (offering, date)
 *  - GET  /attendance/summary?offering_id= → per-offering rate over the seeded window
 *  - GET  /attendance/alerts         → classes + students below the floor (D44)
 *  - GET  /attendance/me             → the signed-in student's own summary + history
 *
 * **D31** — `section_id` became `offering_id` everywhere, and the picker's ref lost its four
 * homeroom fields (`name`, `grade_level`, the division letter, `homeroom_label`) in favour of
 * the shared `OfferingRef`. `teachers[]` stays local and stays keyed `name`, matching the
 * backend: it is this picker's own filter feed, not the directory's teacher shape.
 *
 * DEMO caller resolution: the mock login (fixtures.ts) issues placeholder profile ids
 * that do not map to dataset rows, so we resolve the acting teacher/student from the
 * `sis_mock_session` role cookie — the same approach settings.ts uses. A teacher maps to
 * the canonical demo teacher `teach-1` (Maria Reyes, who owns sections and recorded the
 * seeded register); a student maps to `stu-1` (Freddy Lopez). P/S may view any offering.
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

/** The student the demo acts as for `/attendance/me` (canonical: stu-1 = Freddy Lopez). */
function actingStudentId(): string {
  return getStudent('stu-1')?.id ?? D.students.find((s) => s.status === 'Registered')!.id;
}

/**
 * Offerings the caller may view/record for, scoped to an academic year.
 * Lecturer → own; Dean/Registrar → all. With a `yearId` we restrict to that year (past
 * years included); without one we default to the live (non-archived) offerings.
 *
 * The year is resolved THROUGH the offering's semester — an offering has no year column.
 */
function offeringsForRole(role: string, yearId?: string | null): DemoOffering[] {
  const all = role === 'teacher' ? offeringsOwnedByTeacher(actingTeacherId()) : D.offerings;
  return yearId
    ? all.filter((o) => yearIdOfOffering(o.id) === yearId)
    : all.filter((o) => !o.is_archived);
}

/** Can the caller access this offering at all? (Dean/Registrar: any; Lecturer: own only) */
function canAccessOffering(role: string, offeringId: string): boolean {
  if (role !== 'teacher') return Boolean(getOffering(offeringId));
  return offeringsOwnedByTeacher(actingTeacherId()).some((o) => o.id === offeringId);
}

// ── Wire shapes ────────────────────────────────────────────────────────────────
/**
 * The lecturers who teach an offering (drives the Dean/Registrar lecturer filter).
 *
 * Keyed `name`, not `full_name` — the attendance module's own shape, matching the backend.
 * This used to have to gather ids across every `class_subject` of a section, because a
 * homeroom's "teachers" were the union of its subjects' teachers; an offering names its own.
 */
function teachersForOffering(offering: DemoOffering): Array<{ id: string; name: string }> {
  return offering.teacher_ids
    .map((id) => getTeacher(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({ id: t.id, name: t.full_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The shared `OfferingRef`, nested beside the local `teachers[]`. */
function offeringRef(offering: DemoOffering) {
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  return {
    offering: {
      id: offering.id,
      course: course
        ? { id: course.id, name: course.name, code: course.code, credits: course.credits }
        : { id: offering.course_id, name: 'Unknown course', code: null, credits: null },
      semester: semester
        ? {
            id: semester.id,
            name: semester.name,
            sequence: semester.sequence,
            is_active: semester.is_active,
          }
        : null,
      section_code: offering.section_code,
      label: offeringLabel(offering),
    },
    teachers: teachersForOffering(offering),
  };
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
  // ── Offering picker ─────────────────────────────────────────────────────────────
  // GET /attendance/offerings — what the caller may pick (lecturer: own; Dean/Registrar: all).
  http.get(`${API_BASE_URL}/attendance/offerings`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const canRecord = role === 'teacher';
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    return HttpResponse.json({
      items: offeringsForRole(role, yearId).map((o) => ({
        ...offeringRef(o),
        enrolled_count: rosterFor(o.id).length,
      })),
      can_record: canRecord,
    });
  }),

  // ── Daily register read ───────────────────────────────────────────────────────
  // GET /attendance?offering_id=&date= — roster ∪ any recorded status for the day.
  http.get(`${API_BASE_URL}/attendance`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const offeringId = url.searchParams.get('offering_id');
    const date = url.searchParams.get('date') ?? DEMO_TODAY;
    const role = sessionRole(cookies);

    if (!offeringId) return errorResponse(422, 'validation_error', 'offering_id is required.');
    const offering = getOffering(offeringId);
    if (!offering || !canAccessOffering(role, offeringId)) {
      return errorResponse(404, 'offering_not_found', 'Offering not found.');
    }

    const recorded = attendanceFor(offeringId, date);
    const byStudent = new Map(recorded.map((r) => [r.student_id, r]));
    const roster = rosterFor(offeringId);

    const entries = roster.map((stu) => {
      const rec = byStudent.get(stu.id);
      const enr = activeEnrollmentFor(stu.id, offeringId);
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
      offering: offeringRef(offering),
      date,
      can_record: role === 'teacher',
      entries,
      last_recorded: lastRec
        ? { by: lastUser?.full_name ?? 'Staff', at: lastRec.recorded_at }
        : null,
    });
  }),

  // ── Bulk upsert the register ────────────────────────────────────────────────────
  // PUT /attendance — upsert on (offering_id, student_id, date). Blocks future dates.
  http.put(`${API_BASE_URL}/attendance`, async ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'teacher') {
      return errorResponse(403, 'forbidden', 'Only an assigned lecturer can record attendance.');
    }

    const body = (await request.json()) as {
      offering_id?: string;
      date?: string;
      entries?: Array<{ student_id?: string; status?: string }>;
    };
    const offeringId = body.offering_id;
    const date = body.date;

    if (!offeringId || !date) {
      return errorResponse(422, 'validation_error', 'offering_id and date are required.');
    }
    const offering = getOffering(offeringId);
    if (!offering || !canAccessOffering(role, offeringId)) {
      return errorResponse(404, 'offering_not_found', 'Offering not found.');
    }
    // FR-ATT-05: no future dates (server clock == DEMO_TODAY in the demo).
    if (date > DEMO_TODAY) {
      return errorResponse(422, 'future_date_not_allowed', "You can't record attendance for a future date.");
    }

    const rosterIds = new Set(rosterFor(offeringId).map((s) => s.id));
    const recordedBy = getTeacher(actingTeacherId())?.user_id ?? DEMO_IDS.principalUserId;
    const recordedAt = `${date}T08:15:00Z`;

    let upserted = 0;
    for (const entry of body.entries ?? []) {
      if (!entry.student_id || !isAttendanceStatus(entry.status)) continue;
      // Each student must be actively enrolled in the offering for its own term.
      if (!rosterIds.has(entry.student_id)) continue;
      const enr = activeEnrollmentFor(entry.student_id, offeringId);
      if (!enr) continue;

      const existing = D.attendance_records.find(
        (r) =>
          r.offering_id === offeringId &&
          r.student_id === entry.student_id &&
          r.attendance_date === date,
      );
      if (existing) {
        existing.status = entry.status;
        existing.recorded_by_user_id = recordedBy;
        existing.recorded_at = recordedAt;
      } else {
        const created: DemoAttendanceRecord = {
          id: `att-new-${D.attendance_records.length + 1}`,
          offering_id: offeringId,
          student_id: entry.student_id,
          enrollment_id: enr.id,
          // The OFFERING's term, not "the active one" — a register for a Semester-2
          // offering belongs to Semester 2 even while Semester 1 is the live term.
          semester_id: offering.semester_id,
          attendance_date: date,
          status: entry.status,
          recorded_by_user_id: recordedBy,
          recorded_at: recordedAt,
        };
        D.attendance_records.push(created);
      }
      upserted += 1;
    }

    const dayRecords = attendanceFor(offeringId, date);
    return HttpResponse.json({ upserted, summary: summarize(dayRecords) });
  }),

  // ── Per-offering summary (history/trend over the seeded window) ─────────────────
  // GET /attendance/summary?offering_id= — daily rate points + overall counts.
  http.get(`${API_BASE_URL}/attendance/summary`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const offeringId = url.searchParams.get('offering_id');
    const role = sessionRole(cookies);

    if (!offeringId) return errorResponse(422, 'validation_error', 'offering_id is required.');
    const offering = getOffering(offeringId);
    if (!offering || !canAccessOffering(role, offeringId)) {
      return errorResponse(404, 'offering_not_found', 'Offering not found.');
    }

    const rows = D.attendance_records.filter((r) => r.offering_id === offeringId);
    const dates = [...new Set(rows.map((r) => r.attendance_date))].sort();
    const by_date = dates.map((date) => {
      const dayRows = rows.filter((r) => r.attendance_date === date);
      return { date, ...summarize(dayRows) };
    });

    // Per-student tallies: every actively enrolled student in the offering, with their
    // present/absent/late/excused counts over the window (0s for students with no records).
    const by_student = rosterFor(offeringId)
      .map((stu) => ({
        student: studentRef(stu),
        ...summarize(rows.filter((r) => r.student_id === stu.id)),
      }))
      .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name));

    return HttpResponse.json({
      offering: offeringRef(offering),
      overall: summarize(rows),
      by_date,
      by_student,
    });
  }),

  // ── Attendance alerts (D44) ────────────────────────────────────────────────────
  // GET /attendance/alerts?academic_year_id=&threshold= — classes and students below the
  // floor. Scoped through `offeringsForRole`, the SAME helper the picker uses, so a
  // lecturer is alerted about their own classes here exactly as they are there.
  http.get(`${API_BASE_URL}/attendance/alerts`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const threshold = Number(url.searchParams.get('threshold') ?? 80);

    const offerings = offeringsForRole(role, yearId);
    const flaggedOfferings = [];
    const flaggedStudents = [];

    for (const offering of offerings) {
      const rows = D.attendance_records.filter((r) => r.offering_id === offering.id);
      // An unmarked register is not a class at 0% — it is a class nobody has marked, and
      // reporting it would bury the classes genuinely in trouble.
      if (rows.length === 0) continue;

      const overall = summarize(rows);
      if (overall.pct_present < threshold) {
        flaggedOfferings.push({
          offering: offeringRef(offering),
          enrolled_count: rosterFor(offering.id).length,
          sessions_recorded: rows.length,
          ...overall,
        });
      }

      for (const stu of rosterFor(offering.id)) {
        const own = rows.filter((r) => r.student_id === stu.id);
        if (own.length === 0) continue;
        const counts = summarize(own);
        if (counts.pct_present < threshold) {
          flaggedStudents.push({
            student: studentRef(stu),
            offering: offeringRef(offering),
            sessions_recorded: own.length,
            ...counts,
          });
        }
      }
    }

    // Worst first — the top of an alert list is the point of it.
    flaggedOfferings.sort((a, b) => a.pct_present - b.pct_present);
    flaggedStudents.sort((a, b) => a.pct_present - b.pct_present);

    return HttpResponse.json({
      threshold,
      academic_year_id: yearId,
      offerings: flaggedOfferings,
      students: flaggedStudents,
    });
  }),

  // ── Student's own attendance (FR-ATT-07) ────────────────────────────────────────
  // GET /attendance/me — summary + history for the signed-in student (self only).
  http.get(`${API_BASE_URL}/attendance/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    if (role !== 'student') {
      return errorResponse(403, 'forbidden', 'Only a student can view their own attendance.');
    }
    const studentId = actingStudentId();
    // Global student year·semester switcher: restrict to the selected year's semesters,
    // then to the one selected semester if given.
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const semesterId = url.searchParams.get('semester_id');
    const yearSemIds = new Set(
      D.semesters.filter((s) => !yearId || s.academic_year_id === yearId).map((s) => s.id),
    );
    const rows = D.attendance_records
      .filter(
        (r) =>
          r.student_id === studentId &&
          yearSemIds.has(r.semester_id) &&
          // ADDITIONAL to the year fan-out, not instead of it — mirroring the backend.
          // A semester paired with a foreign year intersects to nothing, and empty is
          // the right answer rather than showing one period under another's heading.
          (!semesterId || r.semester_id === semesterId),
      )
      .sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));

    return HttpResponse.json({
      summary: summarize(rows),
      history: rows.map((r) => ({ date: r.attendance_date, status: r.status })),
    });
  }),
];
