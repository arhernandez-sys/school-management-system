import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  DEMO_TODAY_ISO,
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

function classListItem(section: DemoSection) {
  return {
    id: section.id,
    name: section.name,
    grade_level: section.grade_level,
    section: section.section,
    capacity: section.capacity,
    enrolled_count: rosterFor(section.id).length,
    subject_count: classSubjectsForSection(section.id).filter((c) => c.is_active).length,
    is_archived: section.is_archived,
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
      rows = rows.filter((s) =>
        studentSectionIds.size > 0 ? studentSectionIds.has(s.id) : s.id === student.section_id,
      );
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
    const transferred: Array<{ student_id: string; from_class_id: string }> = [];

    for (const studentId of ids) {
      const student = getStudent(studentId);
      if (!student) return errorResponse(404, 'student_not_found', 'Student not found.');

      // A student is in exactly one section per semester → enrolling elsewhere = transfer.
      const priorActive = D.enrollments.find(
        (e) =>
          e.student_id === studentId &&
          e.semester_id === semesterId &&
          !e.unenrolled_at &&
          e.section_id !== section.id,
      );
      if (priorActive) {
        priorActive.unenrolled_at = DEMO_TODAY_ISO;
        transferred.push({ student_id: studentId, from_class_id: priorActive.section_id });
      }

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
        student.section_id = section.id;
      }
      enrolled.push(rosterEntry(section, student));
    }

    const enrolledCountNow = rosterFor(section.id).length;
    return HttpResponse.json({
      enrolled,
      transferred,
      over_capacity_warning: section.capacity > 0 && enrolledCountNow > section.capacity,
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
      const student = getStudent(enr.student_id);
      if (student && student.section_id === section.id) student.section_id = null;
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
