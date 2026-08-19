import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  classSubjectsForSection,
  getActiveYear,
  getClassSubject,
  getSection,
  getStudent,
  getSubject,
  getTeacher,
  paginate,
  rosterFor,
  assessmentsForClassSubject,
  currentDemoStudent,
  currentDemoTeacher,
  sectionsOwnedByTeacher,
  meetingsForSection,
  unmetPrerequisites,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoClassSubject,
  DemoSection,
  DemoStudent,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the CLASSES / SECTIONS module (api-spec §5 Module 5) — DEMO.
 *
 * Backs features/classes/** offline against the shared demo dataset. Response shapes
 * mirror the api-spec §5 models (ClassListItem / ClassDetail / ClassSubjectItem /
 * RosterEntry). Reads are the focus; enroll + assign-teacher writes mutate
 * DEMO_DATASET in place (single-session demo, per selectors.ts contract).
 *
 * Capacity is warn-only (D-Q6): over-capacity never blocks — it surfaces as
 * `over_capacity` (state) on detail/list and `over_capacity_warning` (action result)
 * on enroll. `is_archived` sections reject writes with 409 year_archived (FR-CLS-06).
 *
 * ⚠️ Do NOT edit handlers/index.ts — `classesHandlers` is wired in there already.
 */
const D = DEMO_DATASET;

/** Acting role from the demo session cookie (same local helper the other handlers use). */
function sessionRole(cookies: Record<string, string>): string {
  return cookies['sis_mock_session'] ?? 'principal';
}

// ── Response shapers (snake_case wire format) ──────────────────────────────────
function subjectRef(subjectId: string) {
  const s = getSubject(subjectId);
  return { id: subjectId, name: s?.name ?? 'Unknown subject', code: s?.code ?? '' };
}

function teacherRef(teacherId: string) {
  const t = getTeacher(teacherId);
  return { id: teacherId, full_name: t?.full_name ?? 'Unknown teacher' };
}

function studentRef(student: DemoStudent) {
  return {
    id: student.id,
    full_name: student.full_name,
    student_number: student.student_number,
  };
}

function meetingItem(m: { id: string; day_of_week: number; start_time: string; end_time: string; room: string | null }) {
  return {
    id: m.id,
    day_of_week: m.day_of_week,
    start_time: m.start_time,
    end_time: m.end_time,
    room: m.room,
  };
}

/**
 * The D29 fields every class row carries: its single subject, teachers and weekly slots.
 *
 * Shared by the list and the detail so they cannot disagree — the real API attaches these
 * to BOTH (a subject-class row is unreadable without them, and fetching per row would be
 * N+1 from the client).
 */
function classCore(section: DemoSection) {
  const cs = classSubjectsForSection(section.id)[0];
  return {
    subject: cs ? subjectRef(cs.subject_id) : null,
    class_subject_id: cs?.id ?? null,
    teachers: cs ? cs.teacher_ids.map(teacherRef) : [],
    lead_teacher_id: cs?.lead_teacher_id ?? null,
    meetings: meetingsForSection(section.id).map(meetingItem),
  };
}

function classListItem(section: DemoSection) {
  return {
    id: section.id,
    name: section.name,
    grade_level: section.grade_level,
    section: section.section,
    capacity: section.capacity,
    enrolled_count: rosterFor(section.id).length,
    is_archived: section.is_archived,
    // `subject_count` is gone (D29): a class teaches exactly one subject, so it was always 1.
    ...classCore(section),
  };
}

function classDetail(section: DemoSection) {
  const year = D.academic_years.find((y) => y.id === section.academic_year_id);
  const enrolled = rosterFor(section.id).length;
  return {
    id: section.id,
    name: section.name,
    grade_level: section.grade_level,
    section: section.section,
    capacity: section.capacity,
    academic_year: year
      ? { id: year.id, name: year.name, status: year.status }
      : { id: section.academic_year_id, name: '', status: 'active' },
    enrolled_count: enrolled,
    over_capacity: section.capacity > 0 && enrolled > section.capacity,
    is_archived: section.is_archived,
    ...classCore(section),
  };
}

function classSubjectItem(cs: DemoClassSubject) {
  return {
    class_subject_id: cs.id,
    subject: subjectRef(cs.subject_id),
    teachers: cs.teacher_ids.map(teacherRef),
    lead_teacher_id: cs.lead_teacher_id,
    assessment_count: assessmentsForClassSubject(cs.id).length,
    is_active: cs.is_active,
    // P/S manage everything in the demo (session role isn't threaded here; the SPA
    // still hides controls for non-writers). Read-only screens ignore this flag.
    actionable_by_caller: true,
  };
}

function rosterEntry(section: DemoSection, student: DemoStudent) {
  const enr = D.enrollments.find(
    (e) =>
      e.student_id === student.id &&
      e.section_id === section.id &&
      e.semester_id === DEMO_IDS.activeSemesterId &&
      !e.unenrolled_at,
  );
  return {
    enrollment_id: enr?.id ?? `enr-${section.id}-${student.id}`,
    student: studentRef(student),
    enrolled_at: enr?.enrolled_at ?? '',
    unenrolled_at: enr?.unenrolled_at ?? null,
  };
}

/** Reject writes to a section whose year is archived (FR-CLS-06 → 409 year_archived). */
function assertWritable(section: DemoSection) {
  if (section.is_archived) return true;
  const year = D.academic_years.find((y) => y.id === section.academic_year_id);
  return year?.status === 'archived';
}

/** "Mon 08:00–09:30" — matches the server-rendered conflict messages. */
const DAY_SHORT: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
function slotLabel(day: number, start: string, end: string): string {
  return `${DAY_SHORT[day] ?? `Day ${day}`} ${start.slice(0, 5)}–${end.slice(0, 5)}`;
}
/** Half-open overlap: back-to-back meetings (09:30 end, 09:30 start) do NOT clash. */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Clashes between one class's week and what a student already sits (D29, warn-only).
 *
 * The real API computes this server-side and ships a rendered `message`, so the mock does
 * the same rather than letting the UI format it — otherwise the demo and the live app would
 * word the same warning differently.
 */
function scheduleConflictsForStudent(studentId: string, section: DemoSection, semesterId: string) {
  const mine = meetingsForSection(section.id);
  if (mine.length === 0) return [];
  const student = getStudent(studentId);
  const otherSectionIds = D.enrollments
    .filter(
      (e) =>
        e.student_id === studentId &&
        e.semester_id === semesterId &&
        !e.unenrolled_at &&
        e.section_id !== section.id,
    )
    .map((e) => e.section_id);

  const out: Array<Record<string, unknown>> = [];
  for (const otherId of otherSectionIds) {
    const other = getSection(otherId);
    if (!other) continue;
    for (const m of meetingsForSection(otherId)) {
      for (const want of mine) {
        if (m.day_of_week !== want.day_of_week) continue;
        if (!overlaps(want.start_time, want.end_time, m.start_time, m.end_time)) continue;
        const slot = slotLabel(m.day_of_week, m.start_time, m.end_time);
        out.push({
          kind: 'student',
          label: student?.full_name ?? 'Student',
          with_class_id: other.id,
          with_class_name: other.name,
          day_of_week: m.day_of_week,
          start_time: m.start_time,
          end_time: m.end_time,
          message: `${student?.full_name ?? 'This student'} already has ${other.name} at ${slot}.`,
        });
      }
    }
  }
  return out;
}

export const classesHandlers = [
  // ── GET /classes — sections list (Page[ClassListItem]) ─────────────────────────
  // Role-scoped like the real backend (FR-CLS-07): a Student sees ONLY their one
  // enrolled section; a Teacher sees only sections they teach a subject in; P/S see all.
  // Role comes from the demo session cookie (see handlers/auth.ts + selectors scope).
  http.get(`${API_BASE_URL}/classes`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies['sis_mock_session'] ?? 'principal';
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const gradeLevel = url.searchParams.get('grade_level');
    const search = url.searchParams.get('search');

    let rows = D.sections;

    // Caller scope (Student → own section, Teacher → owned sections).
    const student = currentDemoStudent(role);
    if (student) {
      // Resolve the student's section FOR THE SELECTED YEAR via enrollments (their
      // `section_id` denorm only points at the current year). Falls back to the
      // current section when no enrollment resolves (keeps the active year working).
      const yearSemIds = new Set(
        D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id),
      );
      const studentSectionIds = new Set(
        D.enrollments
          .filter((e) => e.student_id === student.id && yearSemIds.has(e.semester_id))
          .map((e) => e.section_id),
      );
      // D29: a student sees EVERY class they are enrolled in for the year. There is no
      // fallback to "their one section" any more — the enrollment set IS the answer, and an
      // empty set legitimately means "not enrolled in anything this year".
      rows = rows.filter((s) => studentSectionIds.has(s.id));
    } else {
      const teacher = currentDemoTeacher(role);
      if (teacher) {
        const ownedIds = new Set(sectionsOwnedByTeacher(teacher.id).map((s) => s.id));
        rows = rows.filter((s) => ownedIds.has(s.id));
      }
    }

    if (yearId) rows = rows.filter((s) => s.academic_year_id === yearId);
    if (gradeLevel) rows = rows.filter((s) => s.grade_level === gradeLevel);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((s) => s.name.toLowerCase().includes(q));
    }

    const page = paginate(
      rows.map(classListItem) as unknown as Array<Record<string, unknown>>,
      { ...listParamsFrom(url), sort: url.searchParams.get('sort') ?? 'name' },
    );
    return HttpResponse.json(page);
  }),

  // ── POST /classes — create a new section (Principal/Secretary) ─────────────────
  http.post(`${API_BASE_URL}/classes`, async ({ request }) => {
    const body = (await request.json()) as {
      name?: string;
      grade_level?: string;
      section?: string;
      capacity?: number;
      academic_year_id?: string;
    };
    const name = (body.name ?? '').trim();
    if (!name) {
      return errorResponse(422, 'validation_error', 'Class name is required.', { name: ['Required'] });
    }
    const academic_year_id = body.academic_year_id || getActiveYear()?.id || DEMO_IDS.activeYearId;
    const newSection: DemoSection = {
      id: `sec-new-${D.sections.length + 1}`,
      academic_year_id,
      name,
      grade_level: body.grade_level?.trim() || '',
      section: body.section?.trim() || '',
      homeroom_label: `${name} Homeroom`,
      capacity:
        typeof body.capacity === 'number' && body.capacity > 0 ? Math.floor(body.capacity) : 30,
      is_archived: false,
    };
    D.sections.push(newSection);
    return HttpResponse.json(classDetail(newSection), { status: 201 });
  }),

  // ── GET /classes/{id} — section detail (ClassDetail) ───────────────────────────
  http.get(`${API_BASE_URL}/classes/:classId`, ({ params }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    return HttpResponse.json(classDetail(section));
  }),

  // ── GET /classes/{id}/subjects — class_subjects in the section ─────────────────
  http.get(`${API_BASE_URL}/classes/:classId/subjects`, ({ params }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    const items = classSubjectsForSection(section.id).map(classSubjectItem);
    return HttpResponse.json(items);
  }),

  // ── POST /classes/{id}/subjects — attach a subject to the section (P/S) ────────
  // The first step of the D23 offering lifecycle: no class_subject means no teacher
  // assignment, no gradebook, no assessments.
  http.post(`${API_BASE_URL}/classes/:classId/subjects`, async ({ params, cookies, request }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot change this section’s subjects.');
    }
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');

    const body = (await request.json()) as { subject_id?: string };
    if (!body.subject_id) {
      return errorResponse(422, 'validation_error', 'Missing required fields.', {
        subject_id: ['Required.'],
      });
    }
    const subject = D.subjects.find((s) => s.id === body.subject_id);
    if (!subject) return errorResponse(404, 'not_found', 'Subject not found.');

    if (classSubjectsForSection(section.id).some((cs) => cs.subject_id === subject.id)) {
      return errorResponse(
        409,
        'already_offered',
        `${subject.name} is already offered in this section.`,
      );
    }

    const created: DemoClassSubject = {
      id: `cs-${section.id}-${subject.id}`,
      section_id: section.id,
      subject_id: subject.id,
      teacher_ids: [],
      lead_teacher_id: null,
      is_active: true,
      drop_lowest_count: 0,
    };
    D.class_subjects.push(created);
    return HttpResponse.json(classSubjectItem(created), { status: 201 });
  }),

  // ── DELETE /classes/{id}/subjects/{csId} — detach, only while it has no history ─
  http.delete(
    `${API_BASE_URL}/classes/:classId/subjects/:classSubjectId`,
    ({ params, cookies }) => {
      const role = sessionRole(cookies);
      if (role !== 'principal' && role !== 'secretary') {
        return errorResponse(403, 'forbidden', 'You cannot change this section’s subjects.');
      }
      const idx = D.class_subjects.findIndex((cs) => cs.id === String(params.classSubjectId));
      if (idx === -1) return errorResponse(404, 'not_found', 'Subject offering not found.');

      const cs = D.class_subjects[idx]!;
      if (assessmentsForClassSubject(cs.id).length > 0) {
        return errorResponse(
          409,
          'has_history',
          'This subject has assessments recorded and cannot be removed.',
        );
      }
      D.class_subjects.splice(idx, 1);
      return new HttpResponse(null, { status: 204 });
    },
  ),

  // ── GET /classes/{id}/meetings — the class's weekly schedule (D29, FR-SCH-01) ──
  http.get(`${API_BASE_URL}/classes/:classId/meetings`, ({ params }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    return HttpResponse.json({
      meetings: meetingsForSection(section.id).map(meetingItem),
      conflicts: [],
    });
  }),

  // ── PUT /classes/{id}/meetings — replace the whole week (D29, FR-SCH-02) ───────
  //
  // Conflicts WARN, they do not block: the write always succeeds and the clashes ride back
  // in the response, matching the server (and the over-capacity precedent). A demo that
  // rejected a clashing save would teach the opposite of how the real screen behaves.
  http.put(`${API_BASE_URL}/classes/:classId/meetings`, async ({ params, request }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    if (assertWritable(section)) {
      return errorResponse(409, 'year_archived', 'This class belongs to an archived year.');
    }
    const cs = classSubjectsForSection(section.id)[0];
    if (!cs) {
      return errorResponse(409, 'subject_not_set', 'This class has no subject yet.');
    }
    const body = (await request.json()) as {
      meetings?: Array<{
        day_of_week: number;
        start_time: string;
        end_time: string;
        room?: string | null;
      }>;
    };
    const wanted = body.meetings ?? [];

    // Teacher / room clashes against every OTHER class in the same year.
    const myTeacherIds = new Set(cs.teacher_ids);
    const conflicts: Array<Record<string, unknown>> = [];
    for (const other of D.sections) {
      if (other.id === section.id) continue;
      if (other.academic_year_id !== section.academic_year_id) continue;
      const otherCs = classSubjectsForSection(other.id)[0];
      for (const m of meetingsForSection(other.id)) {
        for (const want of wanted) {
          if (m.day_of_week !== want.day_of_week) continue;
          if (!overlaps(want.start_time, want.end_time, m.start_time, m.end_time)) continue;
          const slot = slotLabel(m.day_of_week, m.start_time, m.end_time);
          for (const tid of otherCs?.teacher_ids ?? []) {
            if (!myTeacherIds.has(tid)) continue;
            const name = getTeacher(tid)?.full_name ?? 'This teacher';
            conflicts.push({
              kind: 'teacher',
              label: name,
              with_class_id: other.id,
              with_class_name: other.name,
              day_of_week: m.day_of_week,
              start_time: m.start_time,
              end_time: m.end_time,
              message: `${name} also teaches ${other.name} at ${slot}.`,
            });
          }
          // Room match is case/whitespace-insensitive, like the server: the office types
          // "Lab 1" and "lab 1" interchangeably.
          const wantRoom = (want.room ?? '').trim().toLowerCase();
          const otherRoom = (m.room ?? '').trim().toLowerCase();
          if (wantRoom && wantRoom === otherRoom) {
            conflicts.push({
              kind: 'room',
              label: m.room ?? '',
              with_class_id: other.id,
              with_class_name: other.name,
              day_of_week: m.day_of_week,
              start_time: m.start_time,
              end_time: m.end_time,
              message: `${m.room} is already used by ${other.name} at ${slot}.`,
            });
          }
        }
      }
    }

    // Replace the set: drop this class's rows, then append the submitted week.
    for (let i = D.class_meetings.length - 1; i >= 0; i -= 1) {
      if (D.class_meetings[i]!.class_subject_id === cs.id) D.class_meetings.splice(i, 1);
    }
    wanted.forEach((w, i) => {
      D.class_meetings.push({
        id: `mtg-new-${cs.id}-${i + 1}`,
        class_subject_id: cs.id,
        day_of_week: w.day_of_week as 1 | 2 | 3 | 4 | 5,
        // The editor submits "HH:MM"; the API serves "HH:MM:SS".
        start_time: w.start_time.length === 5 ? `${w.start_time}:00` : w.start_time,
        end_time: w.end_time.length === 5 ? `${w.end_time}:00` : w.end_time,
        room: w.room?.trim() || null,
      });
    });

    return HttpResponse.json({
      meetings: meetingsForSection(section.id).map(meetingItem),
      conflicts,
    });
  }),

  // ── GET /classes/{id}/roster — active roster (RosterEntry[], not paginated) ────
  http.get(`${API_BASE_URL}/classes/:classId/roster`, ({ params }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    const entries = rosterFor(section.id)
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((student) => rosterEntry(section, student));
    return HttpResponse.json(entries);
  }),

  // ── GET /classes/{id}/enrollable-students — picker for the enroll dialog ───────
  // Classes-owned convenience read (the Students module owns /students). Returns
  // active students NOT already on this section's active roster, name-sorted.
  http.get(`${API_BASE_URL}/classes/:classId/enrollable-students`, ({ params, request }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    const onRoster = new Set(rosterFor(section.id).map((s) => s.id));
    const url = new URL(request.url);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const rows = D.students
      .filter((s) => s.status === 'active' && !onRoster.has(s.id))
      .filter(
        (s) =>
          !search ||
          s.full_name.toLowerCase().includes(search) ||
          s.student_number.toLowerCase().includes(search),
      )
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map(studentRef);
    return HttpResponse.json({ items: rows });
  }),

  // ── POST /classes/{id}/enrollments — enroll (bulk), warn-only capacity ─────────
  //
  // D29: enrolling is ADDITIVE. It used to close the student's active enrollment anywhere
  // else in the semester and report it as a `transfer` — correct when a student had one
  // homeroom, and data loss the moment they legitimately take Math AND Biology. Both the
  // transfer and the `transferred` field are gone; `schedule_conflicts` replaces them.
  http.post(`${API_BASE_URL}/classes/:classId/enrollments`, async ({ params, request }) => {
    const section = getSection(String(params.classId));
    if (!section) return errorResponse(404, 'not_found', 'Class not found.');
    if (assertWritable(section)) {
      return errorResponse(409, 'year_archived', 'This section belongs to an archived year.');
    }
    const body = (await request.json()) as { student_ids?: string[]; semester_id?: string };
    const ids = body.student_ids ?? [];
    const semesterId = body.semester_id ?? DEMO_IDS.activeSemesterId;

    const enrolled: ReturnType<typeof rosterEntry>[] = [];
    // Computed BEFORE the inserts: it asks what the student ALREADY sits that overlaps this
    // class, and the new rows would otherwise be compared against themselves.
    const schedule_conflicts = ids.flatMap((studentId) =>
      scheduleConflictsForStudent(studentId, section, semesterId),
    );

    // D30 §D4 — the prerequisite gate, checked for EVERY student BEFORE anything is
    // written. Mirrors the server exactly, including the all-or-nothing behaviour: a
    // failure part-way through the list would leave the batch half-enrolled.
    const gatedCourseId = D.class_subjects.find(
      (cs) => cs.section_id === section.id && cs.is_active,
    )?.subject_id;
    if (gatedCourseId) {
      for (const studentId of ids) {
        const unmet = unmetPrerequisites(studentId, gatedCourseId, semesterId);
        if (unmet.length > 0) {
          const student = getStudent(studentId);
          const detail = unmet.map((u) => `${u.code} (${u.reason})`).join('; ');
          return errorResponse(
            409,
            'prerequisite_not_met',
            `${student?.full_name ?? 'This student'} has not met the prerequisites: ${detail}.`,
          );
        }
      }
    }

    for (const studentId of ids) {
      const student = getStudent(studentId);
      if (!student) return errorResponse(404, 'student_not_found', 'Student not found.');

      const alreadyHere = D.enrollments.find(
        (e) =>
          e.student_id === studentId &&
          e.section_id === section.id &&
          e.semester_id === semesterId &&
          !e.unenrolled_at,
      );
      if (!alreadyHere) {
        const newEnr = {
          id: `enr-new-${D.enrollments.length + 1}`,
          student_id: studentId,
          section_id: section.id,
          semester_id: semesterId,
          enrolled_at: new Date().toISOString(),
          unenrolled_at: null,
        };
        D.enrollments.push(newEnr);
      }
      enrolled.push(rosterEntry(section, student));
    }

    const enrolledCountNow = rosterFor(section.id).length;
    return HttpResponse.json({
      enrolled,
      over_capacity_warning: section.capacity > 0 && enrolledCountNow > section.capacity,
      schedule_conflicts,
    });
  }),

  // ── DELETE /classes/{id}/enrollments/{enrollmentId} — withdraw ─────────────────
  http.delete(
    `${API_BASE_URL}/classes/:classId/enrollments/:enrollmentId`,
    ({ params }) => {
      const section = getSection(String(params.classId));
      if (!section) return errorResponse(404, 'not_found', 'Class not found.');
      if (assertWritable(section)) {
        return errorResponse(409, 'year_archived', 'This section belongs to an archived year.');
      }
      const enr = D.enrollments.find((e) => e.id === params.enrollmentId);
      if (!enr) return errorResponse(404, 'not_found', 'Enrollment not found.');
      enr.unenrolled_at = new Date().toISOString();
      // D29: nothing else to clear — the student's other enrollments are untouched, and
      // there is no denormalized "current section" on the student any more.
      return new HttpResponse(null, { status: 204 });
    },
  ),

  // ── PUT /classes/{id}/subjects/{csId}/teachers — assign teacher(s) ─────────────
  http.put(
    `${API_BASE_URL}/classes/:classId/subjects/:classSubjectId/teachers`,
    async ({ params, request }) => {
      const section = getSection(String(params.classId));
      if (!section) return errorResponse(404, 'not_found', 'Class not found.');
      if (assertWritable(section)) {
        return errorResponse(409, 'year_archived', 'This section belongs to an archived year.');
      }
      const cs = getClassSubject(String(params.classSubjectId));
      if (!cs) return errorResponse(404, 'class_subject_not_found', 'Class subject not found.');

      const body = (await request.json()) as {
        teacher_ids?: string[];
        lead_teacher_id?: string | null;
      };
      const teacherIds = body.teacher_ids ?? [];
      for (const id of teacherIds) {
        if (!getTeacher(id)) return errorResponse(404, 'teacher_not_found', 'Teacher not found.');
      }
      const lead = body.lead_teacher_id ?? null;
      if (lead && !teacherIds.includes(lead)) {
        return errorResponse(422, 'validation_error', 'Lead teacher must be one of the assigned teachers.');
      }
      cs.teacher_ids = teacherIds;
      cs.lead_teacher_id = lead ?? teacherIds[0] ?? null;
      return HttpResponse.json(classSubjectItem(cs));
    },
  ),
];
