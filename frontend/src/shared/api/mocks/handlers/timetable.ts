import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  currentDemoStudent,
  currentDemoTeacher,
  currentOfferingsFor,
  getCourse,
  getSemester,
  getStudent,
  getTeacher,
  meetingsForOffering,
  offeringLabel,
  offeringsForStudentInYear,
  offeringsOwnedByTeacher,
  yearIdOfOffering,
} from '@shared/api/mocks/demo/dataset';
import type { DemoOffering } from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for the TIMETABLE module (D29, FR-SCH-03..05) — DEMO.
 *
 * Backs features/timetable offline. Two reads:
 *   GET /timetable/me                — the caller's own Mon–Fri week
 *   GET /timetable/students/{id}     — any student's week (P/S)
 *
 * The response is pre-bucketed by weekday and every weekday is present even when empty,
 * exactly like the server: the grid always has five columns, and a blank Wednesday is
 * visibly blank rather than missing.
 *
 * This is the surface that makes the demo's whole point visible — sign in as the student and
 * Monday shows MATH1110-01 in Room A; John (stu-2) would show MATH1110-02 in Room C at a
 * different hour, with Biology and English identical. See the D31 note in demo/data.ts.
 *
 * **D31 collapsed four entry fields into one `offering`.** An entry carried
 * `class_id` + `class_name` + `class_subject_id` + `subject`: four fields describing two
 * rows. A homeroom and the subject it taught are the same row now, so two of those were the
 * same UUID under different names and `class_name` had no column to come from.
 *
 * ⚠️ Do NOT edit handlers/index.ts — `timetableHandlers` is wired in there already.
 */
const DAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
};

function sessionRole(cookies: Record<string, string>): string {
  return cookies['sis_mock_session'] ?? 'principal';
}

/** The shared `OfferingRef` — the same shape every other module now returns. */
function offeringRef(offering: DemoOffering) {
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  return {
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
  };
}
function teacherRef(teacherId: string) {
  const t = getTeacher(teacherId);
  return {
    id: teacherId,
    staff_number: t?.staff_number ?? '',
    full_name: t?.full_name ?? 'Unknown lecturer',
  };
}

/**
 * Shape the week for a set of offerings.
 *
 * An offering with no meetings goes to `unscheduled` rather than being dropped — otherwise
 * it would be invisible here while still listed under My Courses, which reads as a bug.
 */
function buildView(
  offerings: DemoOffering[],
  student: ReturnType<typeof getStudent> | undefined,
  yearId: string | null,
) {
  const days = [1, 2, 3, 4, 5].map((d) => ({
    day_of_week: d,
    day_name: DAY_NAMES[d]!,
    entries: [] as Array<Record<string, unknown>>,
  }));
  const byDay = new Map(days.map((d) => [d.day_of_week, d]));
  const unscheduled: Array<Record<string, unknown>> = [];

  for (const offering of offerings) {
    const ref = offeringRef(offering);
    const teachers = offering.teacher_ids.map(teacherRef);
    const meetings = meetingsForOffering(offering.id);
    if (meetings.length === 0) {
      unscheduled.push({ offering: ref, teachers });
      continue;
    }
    for (const m of meetings) {
      byDay.get(m.day_of_week)?.entries.push({
        meeting_id: m.id,
        offering: ref,
        teachers,
        room: m.room,
        day_of_week: m.day_of_week,
        start_time: m.start_time,
        end_time: m.end_time,
      });
    }
  }

  const labelOf = (row: Record<string, unknown>): string =>
    String((row.offering as { label?: string } | undefined)?.label ?? '');
  for (const d of days) {
    d.entries.sort(
      (a, b) =>
        String(a.start_time).localeCompare(String(b.start_time)) ||
        labelOf(a).localeCompare(labelOf(b)),
    );
  }
  unscheduled.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

  return {
    student: student
      ? {
          id: student.id,
          full_name: student.full_name,
          student_number: student.student_number,
        }
      : null,
    academic_year_id: yearId,
    days,
    unscheduled,
  };
}

/** Offerings in scope for a student — that year if given, else their live load. */
function studentOfferings(studentId: string, yearId: string | null): DemoOffering[] {
  return yearId ? offeringsForStudentInYear(studentId, yearId) : currentOfferingsFor(studentId);
}

export const timetableHandlers = [
  // ── GET /timetable/me — the caller's own week ─────────────────────────────────
  http.get(`${API_BASE_URL}/timetable/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id');

    if (role === 'student') {
      const student = currentDemoStudent(role);
      if (!student) return errorResponse(404, 'student_not_found', 'Student profile not found.');
      return HttpResponse.json(buildView(studentOfferings(student.id, yearId), student, yearId));
    }

    if (role === 'teacher') {
      const teacher = currentDemoTeacher(role);
      const owned = teacher ? offeringsOwnedByTeacher(teacher.id) : [];
      // The year is resolved THROUGH the offering's semester — it has no year column.
      const scoped = yearId ? owned.filter((o) => yearIdOfOffering(o.id) === yearId) : owned;
      return HttpResponse.json(buildView(scoped, undefined, yearId));
    }

    // P/S have no personal timetable — an empty week, not a 403. The nav never offers them
    // this screen; returning empty keeps the endpoint honest for a client that asks anyway.
    return HttpResponse.json(buildView([], undefined, yearId));
  }),

  // ── GET /timetable/students/{id} — any student's week (P/S) ───────────────────
  http.get(`${API_BASE_URL}/timetable/students/:studentId`, ({ params, cookies, request }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'Only the office can view another student’s timetable.');
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, 'student_not_found', 'Student not found.');
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id');
    return HttpResponse.json(buildView(studentOfferings(student.id, yearId), student, yearId));
  }),
];
