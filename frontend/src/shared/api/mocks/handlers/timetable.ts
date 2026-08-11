import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  currentDemoStudent,
  currentDemoTeacher,
  currentSectionsFor,
  classSubjectsForSection,
  getStudent,
  getSubject,
  getTeacher,
  meetingsForSection,
  sectionsForStudentInYear,
  sectionsOwnedByTeacher,
} from '@shared/api/mocks/demo/dataset';
import type { DemoSection } from '@shared/api/mocks/demo/dataset';
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
 * This is the surface that makes the demo's whole point visible — sign in as the student
 * and Monday shows Math-1 in Room A; John (stu-2) would show Math-2 in Room C at a
 * different hour, with Biology and English identical. See the D29 note in demo/data.ts.
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

function subjectRef(subjectId: string) {
  const s = getSubject(subjectId);
  return { id: subjectId, name: s?.name ?? 'Unknown subject', code: s?.code ?? '' };
}
function teacherRef(teacherId: string) {
  const t = getTeacher(teacherId);
  return { id: teacherId, full_name: t?.full_name ?? 'Unknown teacher' };
}

/**
 * Shape the week for a set of classes.
 *
 * A class with no meetings goes to `unscheduled` rather than being dropped — otherwise it
 * would be invisible here while still listed under My Classes, which reads as a bug.
 */
function buildView(sections: DemoSection[], student: ReturnType<typeof getStudent> | undefined, yearId: string | null) {
  const days = [1, 2, 3, 4, 5].map((d) => ({
    day_of_week: d,
    day_name: DAY_NAMES[d]!,
    entries: [] as Array<Record<string, unknown>>,
  }));
  const byDay = new Map(days.map((d) => [d.day_of_week, d]));
  const unscheduled: Array<Record<string, unknown>> = [];

  for (const section of sections) {
    const cs = classSubjectsForSection(section.id)[0];
    if (!cs) continue;
    const subject = subjectRef(cs.subject_id);
    const teachers = cs.teacher_ids.map(teacherRef);
    const meetings = meetingsForSection(section.id);
    if (meetings.length === 0) {
      unscheduled.push({
        class_id: section.id,
        class_name: section.name,
        class_subject_id: cs.id,
        subject,
        teachers,
      });
      continue;
    }
    for (const m of meetings) {
      byDay.get(m.day_of_week)?.entries.push({
        meeting_id: m.id,
        class_id: section.id,
        class_name: section.name,
        class_subject_id: cs.id,
        subject,
        teachers,
        room: m.room,
        day_of_week: m.day_of_week,
        start_time: m.start_time,
        end_time: m.end_time,
      });
    }
  }

  for (const d of days) {
    d.entries.sort(
      (a, b) =>
        String(a.start_time).localeCompare(String(b.start_time)) ||
        String(a.class_name).localeCompare(String(b.class_name)),
    );
  }
  unscheduled.sort((a, b) => String(a.class_name).localeCompare(String(b.class_name)));

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

/** Classes in scope for a student — that year if given, else their live load. */
function studentSections(studentId: string, yearId: string | null): DemoSection[] {
  return yearId ? sectionsForStudentInYear(studentId, yearId) : currentSectionsFor(studentId);
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
      return HttpResponse.json(buildView(studentSections(student.id, yearId), student, yearId));
    }

    if (role === 'teacher') {
      const teacher = currentDemoTeacher(role);
      const owned = teacher ? sectionsOwnedByTeacher(teacher.id) : [];
      const scoped = yearId ? owned.filter((s) => s.academic_year_id === yearId) : owned;
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
    return HttpResponse.json(buildView(studentSections(student.id, yearId), student, yearId));
  }),
];
