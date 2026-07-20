import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  classSubjectsForSection,
  computeTermGrade,
  getSection,
  getStudent,
  getSubject,
  listStudents,
  sectionForStudentInYear,
  sectionsOwnedByTeacher,
  yearsForStudent,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAssessment,
  DemoEnrollment,
  DemoSection,
  DemoStudent,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the STUDENTS module (api-spec §5 Module 3) — DEMO.
 *
 * Backs the Students list + detail screens against the shared demo dataset so numbers
 * reconcile with the dashboard and every other module. Response shapes match the
 * api-spec §5.3 models (StudentListItem / StudentDetail / AssessmentSummary).
 *
 * ROLE + SCOPE are derived SERVER-SIDE from the mock session-role cookie
 * (`sis_mock_session`), exactly like handlers/settings.ts, dashboard.ts and grades.ts:
 * the demo login only carries a role, so we map role → a representative SEEDED user
 * (user-teach-1 / user-stu-1) and derive scope from that.
 *
 *  - principal / secretary → full access to all students.
 *  - teacher → auto-restricted to students in a section they own a subject of
 *    (FR-STU-08); addressing a student OUTSIDE their scope returns 404 (§3.3), never a
 *    leaky 403.
 *  - student → the `/students/{id}` path is rejected (403 → "use /students/me"); the
 *    student reads only their OWN profile via GET /students/me.
 *
 * Writes (POST / PATCH / status / DELETE) mutate DEMO_DATASET in-session with the
 * documented conflict guards (409 duplicate_student_number, 409 has_academic_history).
 *
 * ⚠️ Do NOT touch handlers/index.ts — `studentsHandlers` is already wired in.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';

// ── current-user resolution (mirrors auth.ts session-role cookie) ────────────────
// The demo teacher login ("teacher") is Maria Reyes → teach-1; the demo student login
// ("student") is Ana Lopez → stu-1. We resolve the acting profile from the role cookie
// so scope + ownership (teacher sees own students; student sees self) work offline.
function sessionRole(cookies: Record<string, string>): string {
  return cookies[SESSION_COOKIE] ?? 'principal';
}
function currentTeacherId(role: string): string | null {
  if (role !== 'teacher') return null;
  return D.teachers.find((t) => t.user_id === 'user-teach-1')?.id ?? D.teachers[0]?.id ?? null;
}
function currentStudentId(role: string): string | null {
  if (role !== 'student') return null;
  return D.students.find((s) => s.user_id === 'user-stu-1')?.id ?? D.students[0]?.id ?? null;
}

// ── response-shape mappers (api-spec §4.4 refs + §5.3 models) ─────────────────────
/** ClassRef for the student's current (active-semester) section. */
function sectionRef(section: DemoSection | undefined) {
  if (!section) return null;
  return {
    id: section.id,
    name: section.name,
    grade_level: section.grade_level,
    section: section.section,
  };
}

function currentSectionFor(student: DemoStudent) {
  return student.section_id ? getSection(student.section_id) : undefined;
}

/**
 * The section that scopes a detail-style read. With a `yearId` this is the section the
 * student was enrolled in that year (historical view); without one it's their current
 * (active-semester) section.
 */
function scopedSectionFor(student: DemoStudent, yearId?: string | null) {
  return yearId ? sectionForStudentInYear(student.id, yearId) : currentSectionFor(student);
}

/** StudentListItem (GET /students). */
function studentListItem(s: DemoStudent) {
  return {
    id: s.id,
    student_number: s.student_number,
    full_name: s.full_name,
    status: s.status,
    current_section: sectionRef(currentSectionFor(s)),
    guardian_name: s.guardian_name || null,
  };
}

/**
 * StudentDetail (GET /students/{id}, /me, POST, PATCH, status). With `yearId` the
 * `current_section` reflects the section the student was enrolled in that year.
 */
function studentDetail(s: DemoStudent, yearId?: string | null) {
  return {
    id: s.id,
    student_number: s.student_number,
    full_name: s.full_name,
    date_of_birth: s.date_of_birth,
    gender: s.gender,
    enrollment_date: s.enrollment_date,
    status: s.status,
    guardian_name: s.guardian_name,
    guardian_phone: s.guardian_phone,
    guardian_email: s.guardian_email,
    address: s.address,
    phone: s.phone,
    current_section: sectionRef(scopedSectionFor(s, yearId)),
  };
}

/**
 * AssessmentSummary[] grouped by class_subject for the student's section
 * (GET /students/{id}/assessments). Each group carries the subject label + the
 * student's computed term grade for that offering, and the per-assessment lines.
 */
function assessmentsForStudent(student: DemoStudent, yearId?: string | null) {
  const section = scopedSectionFor(student, yearId);
  if (!section) return [];
  const offerings = classSubjectsForSection(section.id).filter((cs) => cs.is_active);
  return offerings.map((cs) => {
    const subject = getSubject(cs.subject_id);
    const term = computeTermGrade(student.id, cs.id);
    const assessments = D.assessments
      .filter((a) => a.class_subject_id === cs.id)
      .map((a) => assessmentLine(a, student.id));
    return {
      class_subject_id: cs.id,
      subject: subject ? { id: subject.id, name: subject.name, code: subject.code } : null,
      term_grade: { numeric: term.numeric, letter: term.letter },
      assessments,
    };
  });
}

function assessmentLine(a: DemoAssessment, studentId: string) {
  const grade = D.assessment_grades.find(
    (g) => g.assessment_id === a.id && g.student_id === studentId,
  );
  const released = grade?.is_released ?? a.is_released;
  // Scores are only surfaced once released (mirrors the server-side release filter).
  const score = released && grade?.status === 'graded' ? grade.score : null;
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    status: grade?.status ?? 'pending',
    score,
    is_released: released,
  };
}

// ── scope helpers ────────────────────────────────────────────────────────────────
/** Sections the acting teacher owns any subject of (their student scope). */
function teacherSectionIds(teacherId: string): Set<string> {
  return new Set(sectionsOwnedByTeacher(teacherId).map((s) => s.id));
}

/**
 * Resolve a student for a detail-style read, applying role scope. Returns either the
 * student or an error Response so callers can early-return.
 *  - principal/secretary: any live student, else 404.
 *  - teacher: must be in one of their sections, else 404 (no leaky 403).
 *  - student: 403 (must use /students/me).
 */
function resolveScopedStudent(
  role: string,
  id: string,
): { student: DemoStudent } | { error: Response } {
  if (role === 'student') {
    return { error: errorResponse(403, 'forbidden', 'Students read their own profile at /students/me.') };
  }
  const student = getStudent(id);
  if (!student) return { error: errorResponse(404, 'not_found', 'Student not found.') };
  if (role === 'teacher') {
    const teacherId = currentTeacherId(role);
    const scope = teacherId ? teacherSectionIds(teacherId) : new Set<string>();
    if (!student.section_id || !scope.has(student.section_id)) {
      return { error: errorResponse(404, 'not_found', 'Student not found.') };
    }
  }
  return { student };
}

function hasAcademicHistory(studentId: string): boolean {
  return (
    D.assessment_grades.some((g) => g.student_id === studentId) ||
    D.attendance_records.some((a) => a.student_id === studentId)
  );
}

// ── create/patch payload types ───────────────────────────────────────────────────
interface StudentWriteBody {
  student_number?: string;
  full_name?: string;
  date_of_birth?: string;
  gender?: DemoStudent['gender'];
  enrollment_date?: string;
  status?: DemoStudent['status'];
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  address?: string;
  phone?: string;
  section_id?: string | null;
}

const LIVE_STATUSES: DemoStudent['status'][] = ['active', 'inactive', 'transferred'];
function isDuplicateNumber(num: string, exceptId?: string): boolean {
  const q = num.trim().toLowerCase();
  return D.students.some(
    (s) =>
      s.id !== exceptId &&
      LIVE_STATUSES.includes(s.status) &&
      s.student_number.toLowerCase() === q,
  );
}

/** Create an active-semester enrollment linking a student to a section (demo write). */
function enrollStudent(student: DemoStudent, sectionId: string): void {
  // Transfer semantics: stamp any prior active enrollment, then add the new one.
  for (const e of D.enrollments) {
    if (e.student_id === student.id && e.semester_id === DEMO_IDS.activeSemesterId && !e.unenrolled_at) {
      e.unenrolled_at = new Date().toISOString();
    }
  }
  const enrollment: DemoEnrollment = {
    id: `enr-new-${D.enrollments.length + 1}`,
    student_id: student.id,
    section_id: sectionId,
    semester_id: DEMO_IDS.activeSemesterId,
    enrolled_at: new Date().toISOString(),
    unenrolled_at: null,
  };
  D.enrollments.push(enrollment);
  student.section_id = sectionId;
}

export const studentsHandlers = [
  // ── GET /students — searchable, filterable, paginated list ──────────────────────
  http.get(`${API_BASE_URL}/students`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role === 'student') {
      return errorResponse(403, 'forbidden', 'Students do not have access to the roster.');
    }
    const url = new URL(request.url);
    const params = listParamsFrom(url);
    const page = listStudents({
      ...params,
      status: url.searchParams.get('status'),
      // The list accepts `class_id` per api-spec; map to the selector's section filter.
      section_id: url.searchParams.get('class_id') ?? url.searchParams.get('section_id'),
      grade_level: url.searchParams.get('grade_level'),
      // Teacher scope: restrict to students in sections the teacher owns.
      teacher_id: role === 'teacher' ? currentTeacherId(role) : null,
      // Per-module year switcher: restrict to students enrolled in the chosen year.
      academic_year_id: url.searchParams.get('academic_year_id'),
    });
    return HttpResponse.json({ ...page, items: page.items.map(studentListItem) });
  }),

  // ── GET /students/me/years — academic years the acting student was enrolled in ──
  // Backs the student-only top-bar year switcher.
  http.get(`${API_BASE_URL}/students/me/years`, ({ cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'student') {
      return errorResponse(403, 'forbidden', 'Only students may read /students/me/years.');
    }
    const id = currentStudentId(role);
    const years = id ? yearsForStudent(id) : [];
    return HttpResponse.json({
      items: years.map((y) => ({ id: y.id, name: y.name, status: y.status })),
    });
  }),

  // ── GET /students/me — the student's own profile (student role only) ────────────
  http.get(`${API_BASE_URL}/students/me`, ({ cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'student') {
      return errorResponse(403, 'forbidden', 'Only students may read /students/me.');
    }
    const id = currentStudentId(role);
    const student = id ? getStudent(id) : undefined;
    if (!student) return errorResponse(404, 'no_student_profile', 'No student profile.');
    return HttpResponse.json(studentDetail(student));
  }),

  // ── GET /students/{id}/years — academic years this student was enrolled in ──────
  // Backs the per-student year filter on the profile page (P/S/teacher, scope-checked).
  http.get(`${API_BASE_URL}/students/:studentId/years`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    const resolved = resolveScopedStudent(role, String(params.studentId));
    if ('error' in resolved) return resolved.error;
    const years = yearsForStudent(resolved.student.id);
    return HttpResponse.json({
      items: years.map((y) => ({ id: y.id, name: y.name, status: y.status })),
    });
  }),

  // ── GET /students/{id}/assessments — grouped assessment summary ─────────────────
  // `?academic_year_id=` scopes to the section the student had that year.
  http.get(`${API_BASE_URL}/students/:studentId/assessments`, ({ params, cookies, request }) => {
    const role = sessionRole(cookies);
    const resolved = resolveScopedStudent(role, String(params.studentId));
    if ('error' in resolved) return resolved.error;
    const yearId = new URL(request.url).searchParams.get('academic_year_id');
    return HttpResponse.json({ items: assessmentsForStudent(resolved.student, yearId) });
  }),

  // ── GET /students/{id} — detail header ──────────────────────────────────────────
  // `?academic_year_id=` scopes `current_section` to that year.
  http.get(`${API_BASE_URL}/students/:studentId`, ({ params, cookies, request }) => {
    const role = sessionRole(cookies);
    const resolved = resolveScopedStudent(role, String(params.studentId));
    if ('error' in resolved) return resolved.error;
    const yearId = new URL(request.url).searchParams.get('academic_year_id');
    return HttpResponse.json(studentDetail(resolved.student, yearId));
  }),

  // ── POST /students — create (principal / secretary) ─────────────────────────────
  http.post(`${API_BASE_URL}/students`, async ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot create students.');
    }
    const body = (await request.json()) as StudentWriteBody;
    if (!body.student_number || !body.full_name || !body.date_of_birth || !body.enrollment_date) {
      return errorResponse(422, 'validation_error', 'Missing required fields.', {
        ...(body.student_number ? {} : { student_number: ['Required.'] }),
        ...(body.full_name ? {} : { full_name: ['Required.'] }),
        ...(body.date_of_birth ? {} : { date_of_birth: ['Required.'] }),
        ...(body.enrollment_date ? {} : { enrollment_date: ['Required.'] }),
      });
    }
    if (isDuplicateNumber(body.student_number)) {
      return errorResponse(409, 'duplicate_student_number', 'This student number is already in use.', {
        student_number: ['Already in use by a live student.'],
      });
    }
    if (body.section_id) {
      const section = getSection(body.section_id);
      if (section?.is_archived) {
        return errorResponse(409, 'section_archived', 'That section is archived.');
      }
    }
    const created: DemoStudent = {
      id: `stu-new-${D.students.length + 1}`,
      user_id: null,
      student_number: body.student_number,
      full_name: body.full_name,
      date_of_birth: body.date_of_birth,
      gender: body.gender ?? 'female',
      enrollment_date: body.enrollment_date,
      status: body.status ?? 'active',
      guardian_name: body.guardian_name ?? '',
      guardian_phone: body.guardian_phone ?? '',
      guardian_email: body.guardian_email ?? '',
      address: body.address ?? '',
      phone: body.phone ?? '',
      section_id: null,
    };
    D.students.push(created);
    if (body.section_id) enrollStudent(created, body.section_id);
    return HttpResponse.json(studentDetail(created), { status: 201 });
  }),

  // ── PATCH /students/{id} — edit profile (status NOT editable here) ──────────────
  http.patch(`${API_BASE_URL}/students/:studentId`, async ({ params, request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot edit students.');
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, 'not_found', 'Student not found.');
    const body = (await request.json()) as StudentWriteBody;
    if (body.student_number && isDuplicateNumber(body.student_number, student.id)) {
      return errorResponse(409, 'duplicate_student_number', 'This student number is already in use.', {
        student_number: ['Already in use by a live student.'],
      });
    }
    if (body.student_number !== undefined) student.student_number = body.student_number;
    if (body.full_name !== undefined) student.full_name = body.full_name;
    if (body.date_of_birth !== undefined) student.date_of_birth = body.date_of_birth;
    if (body.gender !== undefined) student.gender = body.gender;
    if (body.enrollment_date !== undefined) student.enrollment_date = body.enrollment_date;
    if (body.guardian_name !== undefined) student.guardian_name = body.guardian_name ?? '';
    if (body.guardian_phone !== undefined) student.guardian_phone = body.guardian_phone ?? '';
    if (body.guardian_email !== undefined) student.guardian_email = body.guardian_email ?? '';
    if (body.address !== undefined) student.address = body.address ?? '';
    if (body.phone !== undefined) student.phone = body.phone ?? '';
    if (body.section_id) enrollStudent(student, body.section_id);
    return HttpResponse.json(studentDetail(student));
  }),

  // ── POST /students/{id}/status — lifecycle change (auditable, guarded) ──────────
  http.post(`${API_BASE_URL}/students/:studentId/status`, async ({ params, request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot change student status.');
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, 'not_found', 'Student not found.');
    const body = (await request.json()) as { status?: DemoStudent['status'] };
    const next = body.status;
    const allowed: DemoStudent['status'][] = [
      'active',
      'inactive',
      'transferred',
      'graduated',
      'withdrawn',
    ];
    if (!next || !allowed.includes(next)) {
      return errorResponse(422, 'invalid_transition', 'That status change is not allowed.');
    }
    student.status = next;
    return HttpResponse.json(studentDetail(student));
  }),

  // ── DELETE /students/{id} — soft-delete only if no academic history ─────────────
  http.delete(`${API_BASE_URL}/students/:studentId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot delete students.');
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, 'not_found', 'Student not found.');
    if (hasAcademicHistory(student.id)) {
      return errorResponse(
        409,
        'has_academic_history',
        'This student has grades or attendance on record — deactivate instead.',
      );
    }
    D.students = D.students.filter((s) => s.id !== student.id);
    D.enrollments = D.enrollments.filter((e) => e.student_id !== student.id);
    return new HttpResponse(null, { status: 204 });
  }),
];
