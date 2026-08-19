import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  DEMO_TODAY,
  computeTermGrade,
  getActiveGradingScale,
  getActiveSemester,
  gpaFor,
  gradePointFor,
  getSection,
  getStudent,
  getSubject,
  listStudents,
  sectionsForStudentInYear,
  currentSectionsFor,
  classSubjectsForStudent,
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
import { NUDGE_COOLDOWN_SECONDS, lastNudgedAt } from './_nudges';

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

/**
 * The subject classes that scope a detail-style read. With a `yearId` these are the classes
 * the student sat that year (historical view); without one, their live load.
 *
 * D29: a LIST. It used to be one section, on the premise that a student had exactly one.
 */
function scopedSectionsFor(student: DemoStudent, yearId?: string | null) {
  return yearId ? sectionsForStudentInYear(student.id, yearId) : currentSectionsFor(student.id);
}

/**
 * The display name, assembled exactly as `StudentProfile.full_name` does on the
 * server (D30 §D10) — parts joined by a single space, blanks skipped. Demo mode has
 * to agree with the backend here or the Students list would certify a name format
 * the real API never produces.
 */
function displayName(
  first: string | null,
  middle: string | null,
  last: string,
): string {
  return [first, middle, last].filter(Boolean).join(' ');
}

/**
 * `YYYYMM###` for demo mode (D30 §D9).
 *
 * Deliberately NOT a faithful copy of the server's sequence table — there is no
 * concurrency to protect against in a single browser tab. It scans the numbers
 * already issued this month and takes the next one, which is enough for the demo to
 * show the right SHAPE and the right increment while staying obviously local.
 */
function allocateStudentNumber(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const used = D.students
    .map((s) => s.student_number)
    .filter((n) => n.startsWith(ym) && n.length === 9)
    .map((n) => Number(n.slice(6)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${ym}${String(next).padStart(3, '0')}`;
}

/** StudentListItem (GET /students). */
function studentListItem(s: DemoStudent) {
  return {
    id: s.id,
    student_number: s.student_number,
    full_name: s.full_name,
    first_name: s.first_name,
    middle_name: s.middle_name,
    last_name: s.last_name,
    status: s.status,
    // D29: the row shows the student's own level + how many classes they take. Their class
    // NAMES are a variable-length list that belongs on the detail page, not a table cell.
    year_group: s.year_group,
    class_count: currentSectionsFor(s.id).length,
    guardian_name: s.guardian_name || null,
  };
}

/**
 * StudentDetail (GET /students/{id}, /me, POST, PATCH, status). With `yearId` the
 * `current_classes` reflect the classes the student sat that year.
 */
function studentDetail(s: DemoStudent, yearId?: string | null) {
  return {
    id: s.id,
    student_number: s.student_number,
    full_name: s.full_name,
    first_name: s.first_name,
    middle_name: s.middle_name,
    last_name: s.last_name,
    date_of_birth: s.date_of_birth,
    gender: s.gender,
    year_group: s.year_group,
    enrollment_date: s.enrollment_date,
    status: s.status,
    guardian_name: s.guardian_name,
    guardian_phone: s.guardian_phone,
    guardian_email: s.guardian_email,
    address: s.address,
    phone: s.phone,
    current_classes: scopedSectionsFor(s, yearId).map(sectionRef).filter(Boolean),
  };
}

/**
 * AssessmentSummary[] grouped by class_subject for the student's section
 * (GET /students/{id}/assessments). Each group carries the subject label + the
 * student's computed term grade for that offering, and the per-assessment lines.
 */
function assessmentsForStudent(student: DemoStudent, yearId?: string | null) {
  // D29: spans every class the student sits, not the subjects of one homeroom.
  const offerings = classSubjectsForStudent(student.id, yearId).filter((cs) => cs.is_active);
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
    // Read back from the demo nudge log, exactly as the real API derives it from
    // the most recent `grade.release_nudge` audit row. Drives the "Reminded 2h ago"
    // disabled state on the principal's Remind-teacher action.
    last_nudged_at: lastNudgedAt(a.id),
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
    // D29: reachable if ANY of the student's classes is one this teacher owns.
    const shared = currentSectionsFor(student.id).some((sec) => scope.has(sec.id));
    if (!shared) {
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
  /** D30 §D9 — optional on create; the server issues the next YYYYMM###. */
  student_number?: string;
  /** D30 §D10 — the name is written in parts; `full_name` is computed, never sent. */
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  date_of_birth?: string;
  gender?: DemoStudent['gender'];
  enrollment_date?: string;
  status?: DemoStudent['status'];
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  address?: string;
  phone?: string;
  year_group?: string | null;
  /** D29: many subject classes to enrol into on CREATE (replaced the single section_id). */
  class_ids?: string[];
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
  // D29: ADDITIVE. This used to stamp every prior active enrollment closed ("transfer
  // semantics"), which under a subject-class model would drop the student from Math the
  // moment they were added to Biology.
  const already = D.enrollments.some(
    (e) =>
      e.student_id === student.id &&
      e.section_id === sectionId &&
      e.semester_id === DEMO_IDS.activeSemesterId &&
      !e.unenrolled_at,
  );
  if (already) return;
  const enrollment: DemoEnrollment = {
    id: `enr-new-${D.enrollments.length + 1}`,
    student_id: student.id,
    section_id: sectionId,
    semester_id: DEMO_IDS.activeSemesterId,
    enrolled_at: new Date().toISOString(),
    unenrolled_at: null,
  };
  D.enrollments.push(enrollment);
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
  // `?academic_year_id=` scopes `current_section` to that year, exactly as the staff
  // `/students/{id}` route below already did. It was missing here, so "My Profile" kept
  // showing the CURRENT section while every other screen followed the global switcher —
  // and the student sits in a different section each year.
  http.get(`${API_BASE_URL}/students/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    if (role !== 'student') {
      return errorResponse(403, 'forbidden', 'Only students may read /students/me.');
    }
    const id = currentStudentId(role);
    const student = id ? getStudent(id) : undefined;
    if (!student) return errorResponse(404, 'no_student_profile', 'No student profile.');
    const yearId = new URL(request.url).searchParams.get('academic_year_id');
    return HttpResponse.json(studentDetail(student, yearId));
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
    // `nudge_cooldown_seconds` rides in the envelope so the SPA never keeps its own
    // copy of the window — the server owns it and can retune without a frontend release.
    return HttpResponse.json({
      items: assessmentsForStudent(resolved.student, yearId),
      nudge_cooldown_seconds: NUDGE_COOLDOWN_SECONDS,
    });
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
    // D30 §D9: `student_number` is NOT required — omitted, one is issued. The name
    // parts are, and `full_name` is not accepted as a write field at all.
    if (!body.first_name || !body.last_name || !body.date_of_birth || !body.enrollment_date) {
      return errorResponse(422, 'validation_error', 'Missing required fields.', {
        ...(body.first_name ? {} : { first_name: ['Required.'] }),
        ...(body.last_name ? {} : { last_name: ['Required.'] }),
        ...(body.date_of_birth ? {} : { date_of_birth: ['Required.'] }),
        ...(body.enrollment_date ? {} : { enrollment_date: ['Required.'] }),
      });
    }
    if (body.student_number && isDuplicateNumber(body.student_number)) {
      return errorResponse(409, 'duplicate_student_number', 'This student number is already in use.', {
        student_number: ['Already in use by a live student.'],
      });
    }
    // D29: `class_ids` (many) replaced the single `section_id`.
    for (const classId of body.class_ids ?? []) {
      const section = getSection(classId);
      if (section?.is_archived) {
        return errorResponse(409, 'section_archived', 'That class is archived.');
      }
    }
    const created: DemoStudent = {
      id: `stu-new-${D.students.length + 1}`,
      user_id: null,
      student_number: body.student_number || allocateStudentNumber(),
      first_name: body.first_name,
      middle_name: body.middle_name ?? null,
      last_name: body.last_name,
      full_name: displayName(body.first_name, body.middle_name ?? null, body.last_name),
      date_of_birth: body.date_of_birth,
      gender: body.gender ?? 'female',
      enrollment_date: body.enrollment_date,
      status: body.status ?? 'active',
      guardian_name: body.guardian_name ?? '',
      guardian_phone: body.guardian_phone ?? '',
      guardian_email: body.guardian_email ?? '',
      address: body.address ?? '',
      phone: body.phone ?? '',
      year_group: body.year_group ?? null,
      // Phase 4 (§D12) is what assigns a programme; a student created here has none.
      program_id: null,
    };
    D.students.push(created);
    for (const classId of body.class_ids ?? []) enrollStudent(created, classId);
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
    if (body.first_name !== undefined) student.first_name = body.first_name;
    if (body.middle_name !== undefined) student.middle_name = body.middle_name || null;
    if (body.last_name !== undefined) student.last_name = body.last_name;
    // `full_name` is derived, so it is recomputed after any name edit — never set.
    student.full_name = displayName(student.first_name, student.middle_name, student.last_name);
    if (body.date_of_birth !== undefined) student.date_of_birth = body.date_of_birth;
    if (body.gender !== undefined) student.gender = body.gender;
    if (body.enrollment_date !== undefined) student.enrollment_date = body.enrollment_date;
    if (body.guardian_name !== undefined) student.guardian_name = body.guardian_name ?? '';
    if (body.guardian_phone !== undefined) student.guardian_phone = body.guardian_phone ?? '';
    if (body.guardian_email !== undefined) student.guardian_email = body.guardian_email ?? '';
    if (body.address !== undefined) student.address = body.address ?? '';
    if (body.phone !== undefined) student.phone = body.phone ?? '';
    if (body.year_group !== undefined) student.year_group = body.year_group ?? null;
    // Enrollment is NOT a PATCH field (D29) — it moves under Classes → Roster.
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

  // ── GET /students/{id}/academic-history — DERIVED (D30 §D12, brief §27) ─────────
  // Recomputed on every call from enrolments, results, approved transfers and the
  // programme curriculum. Nothing is cached as truth, exactly as the server does it.
  http.get(`${API_BASE_URL}/students/:studentId/academic-history`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot view academic history.');
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, 'not_found', 'Student not found.');

    const program = D.programs.find((p) => p.id === student.program_id) ?? null;
    // The pass mark is per PROGRAMME (§D5) — Primary Education at C, the rest at C+ — so
    // the SAME letter can be a pass on one programme and a fail on another.
    const minGradePoint = Number(program?.min_passing_grade_point ?? '2.50');

    const plan = program
      ? D.program_courses.filter((pc) => pc.program_id === program.id)
      : [];
    const planByCourse = new Map(plan.map((pc) => [pc.course_id, pc]));

    // Approved credit transfers reach the student through their APPLICATION, because
    // policy anchors a transfer there: it can only be requested at admission.
    const application = D.applications.find((a) => a.student_id === student.id);
    const transferred = new Set(
      application
        ? D.credit_transfer_requests
            .filter((t) => t.application_id === application.id && t.status === 'approved')
            .map((t) => t.target_course_id)
        : [],
    );

    // Every course the student has ever sat, keyed by COURSE — the question is about the
    // course, and the same one may have been taken in two terms.
    const enrolled = new Map<string, string>();
    for (const enr of D.enrollments.filter((e) => e.student_id === student.id)) {
      for (const cs of D.class_subjects.filter((c) => c.section_id === enr.section_id)) {
        enrolled.set(cs.subject_id, enr.semester_id);
      }
    }

    const scale = getActiveGradingScale();
    const courseIds = new Set<string>([
      ...planByCourse.keys(),
      ...transferred,
      ...enrolled.keys(),
    ]);

    const counts = { completed: 0, failed: 0, in_progress: 0, transferred: 0, remaining: 0 };
    let creditsEarned = 0;
    const gpaEntries: { credits: number | null; letter: string | null }[] = [];
    const courses: Record<string, unknown>[] = [];

    for (const courseId of courseIds) {
      const course = getSubject(courseId);
      if (!course) continue;
      const pc = planByCourse.get(courseId) ?? null;
      const credits = course.credits ?? 0;

      // The student's result in this course, from whichever offering they sat.
      let letter: string | null = null;
      let numeric: number | null = null;
      for (const cs of D.class_subjects.filter((c) => c.subject_id === courseId)) {
        const term = computeTermGrade(student.id, cs.id);
        if (term.numeric != null && (numeric == null || term.numeric > numeric)) {
          numeric = term.numeric;
          letter = term.letter;
        }
      }
      const gradePoint = gradePointFor(letter);

      let status: keyof typeof counts;
      if (transferred.has(courseId)) {
        status = 'transferred';
        creditsEarned += credits;
      } else if (numeric != null) {
        // Judged against the PROGRAMME's pass mark. Where the scale carries no grade
        // points the band's own `is_passing` decides, the same lenient fallback the
        // server uses for a pre-Phase-3 scale.
        const band = scale?.bands.find((b) => b.letter === letter);
        const passed =
          gradePoint != null ? gradePoint >= minGradePoint : Boolean(band?.is_passing);
        status = passed ? 'completed' : 'failed';
        if (passed) creditsEarned += credits;
        gpaEntries.push({ credits, letter });
      } else if (enrolled.has(courseId)) {
        status = 'in_progress';
        // Credits count toward the GPA denominator; no quality points yet (decision #4).
        gpaEntries.push({ credits, letter: null });
      } else {
        status = 'remaining';
      }
      counts[status] += 1;

      courses.push({
        course_id: course.id,
        code: course.code,
        name: course.name,
        credits: course.credits,
        term_label: pc?.term_label ?? null,
        term_order: pc?.term_order ?? null,
        is_required: pc ? pc.is_required : false,
        in_curriculum: pc !== null,
        status,
        numeric,
        letter,
        grade_point: gradePoint,
        // Demo mode has no frozen snapshots — everything is computed live.
        is_frozen: false,
        semester_id: enrolled.get(courseId) ?? null,
      });
    }

    // Plan order first, then code, so the screen reads down the programme sequence.
    courses.sort((a, b) => {
      const ao = a.term_order as number | null;
      const bo = b.term_order as number | null;
      if (ao == null && bo == null) return String(a.code).localeCompare(String(b.code));
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo || String(a.code).localeCompare(String(b.code));
    });

    const requiredCredits = plan
      .filter((pc) => pc.is_required)
      .reduce((sum, pc) => sum + (getSubject(pc.course_id)?.credits ?? 0), 0);
    const earnedRequired = courses
      .filter(
        (row) =>
          row.is_required === true &&
          (row.status === 'completed' || row.status === 'transferred'),
      )
      .reduce((sum, row) => sum + ((row.credits as number | null) ?? 0), 0);
    const gpa = gpaFor(gpaEntries);

    return HttpResponse.json({
      student_id: student.id,
      full_name: student.full_name,
      student_number: student.student_number,
      program: program ? { id: program.id, code: program.code, name: program.name } : null,
      year_of_study: student.year_group === 'Second' ? 'Second' : student.year_group === 'First' ? 'First' : null,
      enrollment_load: null,
      program_total_credits: program?.total_credits ?? null,
      curriculum_required_credits: requiredCredits,
      credits_earned: creditsEarned,
      // Against the REQUIRED plan only: electives the student chose not to take are not
      // outstanding requirements.
      credits_remaining: Math.max(requiredCredits - earnedRequired, 0),
      gpa: gpa.gpa,
      gpa_total_credits: gpa.total_credits,
      counts,
      courses,
      program_history: D.student_program_history
        .filter((h) => h.student_id === student.id)
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((h) => {
          const p = D.programs.find((pr) => pr.id === h.program_id);
          return {
            id: h.id,
            program: { id: h.program_id, code: p?.code ?? '', name: p?.name ?? '' },
            started_at: h.started_at,
            ended_at: h.ended_at,
            reason: h.reason,
            is_current: h.ended_at === null,
          };
        }),
      active_semester_id: getActiveSemester()?.id ?? null,
    });
  }),

  // ── PUT /students/{id}/program — DEAN ONLY (D30 §D12, §D14) ────────────────────
  http.put(`${API_BASE_URL}/students/:studentId/program`, async ({ params, request, cookies }) => {
    // The Registrar owns the student record and admits students, but MOVING one between
    // programmes re-derives their degree plan and rules on what carries over.
    if (sessionRole(cookies) !== 'principal') {
      return errorResponse(403, 'forbidden', 'Only the Dean may change a student\'s programme.');
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, 'not_found', 'Student not found.');
    const body = (await request.json()) as {
      program_id?: string;
      effective_from?: string | null;
      reason?: string | null;
      year_of_study?: string | null;
      enrollment_load?: string | null;
    };
    const program = D.programs.find((p) => p.id === body.program_id);
    if (!program) return errorResponse(404, 'program_not_found', 'Programme not found.');
    if (student.program_id === program.id) {
      return errorResponse(
        409,
        'program_unchanged',
        `This student is already registered on ${program.code}.`,
      );
    }

    const effective = body.effective_from || DEMO_TODAY;
    const open = D.student_program_history.find(
      (h) => h.student_id === student.id && h.ended_at === null,
    );
    if (open) {
      if (effective < open.started_at) {
        return errorResponse(
          422,
          'validation_error',
          `The change cannot take effect before the current programme started (${open.started_at}).`,
          { effective_from: ['Earlier than the current registration.'] },
        );
      }
      // Closed the day BEFORE the new one opens, so the periods are contiguous with
      // neither an overlap nor a gap — and never two open rows, which the real database
      // refuses outright via a unique index over a generated `open_flag`.
      const dayBefore = new Date(`${effective}T00:00:00`);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const closed = dayBefore.toISOString().slice(0, 10);
      open.ended_at = closed < open.started_at ? open.started_at : closed;
      open.reason = open.reason ?? body.reason ?? null;
    }
    D.student_program_history.push({
      id: `sph-demo-${D.student_program_history.length + 1}`,
      student_id: student.id,
      program_id: program.id,
      started_at: effective,
      ended_at: null,
      reason: body.reason ?? null,
    });
    student.program_id = program.id;
    if (body.year_of_study) student.year_group = body.year_of_study;

    return HttpResponse.json({
      student_id: student.id,
      program: { id: program.id, code: program.code, name: program.name },
      year_of_study: body.year_of_study ?? null,
      enrollment_load: body.enrollment_load ?? null,
      history: D.student_program_history
        .filter((h) => h.student_id === student.id)
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((h) => {
          const p = D.programs.find((pr) => pr.id === h.program_id);
          return {
            id: h.id,
            program: { id: h.program_id, code: p?.code ?? '', name: p?.name ?? '' },
            started_at: h.started_at,
            ended_at: h.ended_at,
            reason: h.reason,
            is_current: h.ended_at === null,
          };
        }),
    });
  }),
];
