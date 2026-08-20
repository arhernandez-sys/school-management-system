import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY,
  computeTermGrade,
  getActiveGradingScale,
  getActiveSemester,
  gpaFor,
  gradePointFor,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  listStudents,
  offeringLabel,
  offeringsForStudentInYear,
  offeringsForStudent,
  currentOfferingsFor,
  offeringsOwnedByTeacher,
  yearsForStudent,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAssessment,
  DemoEnrollment,
  DemoOffering,
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
 *  - teacher → auto-restricted to students enrolled in an offering they teach
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
// ("student") is Freddy Lopez → stu-1. We resolve the acting profile from the role cookie
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
/**
 * The shared `OfferingRef`. It replaced a local ref carrying `name`, `grade_level` and the
 * division letter — three homeroom columns, none of which exist now.
 */
function offeringRef(offering: DemoOffering | undefined) {
  if (!offering) return null;
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

/**
 * The offerings that scope a detail-style read. With a `yearId` these are the offerings the
 * student sat that year (historical view); without one, their live load.
 */
function scopedOfferingsFor(student: DemoStudent, yearId?: string | null) {
  return yearId ? offeringsForStudentInYear(student.id, yearId) : currentOfferingsFor(student.id);
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
    // The row shows the student's own level + how many courses they take. The course names
    // are a variable-length list that belongs on the detail page, not in a table cell.
    year_of_study: s.year_of_study,
    offering_count: currentOfferingsFor(s.id).length,
    guardian_name: s.guardian_name || null,
  };
}

/**
 * StudentDetail (GET /students/{id}, /me, POST, PATCH, status). With `yearId` the
 * `current_offerings` reflect the offerings the student sat that year.
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
    year_of_study: s.year_of_study,
    enrollment_date: s.enrollment_date,
    status: s.status,
    guardian_name: s.guardian_name,
    guardian_phone: s.guardian_phone,
    guardian_email: s.guardian_email,
    address: s.address,
    phone: s.phone,
    current_offerings: scopedOfferingsFor(s, yearId).map(offeringRef).filter(Boolean),
  };
}

/**
 * AssessmentSummary[] grouped by OFFERING (GET /students/{id}/assessments). Each group
 * carries the course ref + the student's computed term grade for that offering, and the
 * per-assessment lines.
 *
 * The group key is `offering_id` (D31: was `class_subject_id`). The `subject` field keeps its
 * wire name and carries a course ref — one of the few places the server still spells the
 * catalog entry "subject", so the handler matches it rather than inventing a better name.
 */
function assessmentsForStudent(student: DemoStudent, yearId?: string | null) {
  const offerings = offeringsForStudent(student.id, yearId).filter((o) => !o.is_archived);
  return offerings.map((offering) => {
    const course = getCourse(offering.course_id);
    const term = computeTermGrade(student.id, offering.id);
    const assessments = D.assessments
      .filter((a) => a.offering_id === offering.id)
      .map((a) => assessmentLine(a, student.id));
    return {
      offering_id: offering.id,
      subject: course
        ? { id: course.id, name: course.name, code: course.code, credits: course.credits }
        : null,
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
/** Offerings the acting lecturer teaches (their student scope). */
function teacherOfferingIds(teacherId: string): Set<string> {
  return new Set(offeringsOwnedByTeacher(teacherId).map((o) => o.id));
}

/**
 * Resolve a student for a detail-style read, applying role scope. Returns either the
 * student or an error Response so callers can early-return.
 *  - principal/secretary: any live student, else 404.
 *  - teacher: must be in one of their offerings, else 404 (no leaky 403).
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
    const scope = teacherId ? teacherOfferingIds(teacherId) : new Set<string>();
    // Reachable if ANY of the student's offerings is one this lecturer teaches.
    const shared = currentOfferingsFor(student.id).some((o) => scope.has(o.id));
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
  year_of_study?: DemoStudent['year_of_study'];
  /** Many offerings to enrol into on CREATE (D29 replaced the single section_id; D31
   *  renamed `class_ids` → `offering_ids`). */
  offering_ids?: string[];
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

/**
 * Create an enrollment linking a student to an offering (demo write).
 *
 * ADDITIVE. This used to stamp every prior active enrollment closed ("transfer semantics"),
 * which would drop the student from Algebra the moment they were added to Biology.
 *
 * The term comes off the OFFERING, not from the school's active semester: an offering belongs
 * to one term, so hardcoding the live one would file a Semester-2 enrolment under Semester 1
 * and make the roster unreachable from every screen that scopes by term.
 */
function enrollStudent(student: DemoStudent, offeringId: string): void {
  const offering = getOffering(offeringId);
  if (!offering) return;
  const already = D.enrollments.some(
    (e) =>
      e.student_id === student.id &&
      e.offering_id === offering.id &&
      e.semester_id === offering.semester_id &&
      !e.unenrolled_at,
  );
  if (already) return;
  const enrollment: DemoEnrollment = {
    id: `enr-new-${D.enrollments.length + 1}`,
    student_id: student.id,
    offering_id: offering.id,
    semester_id: offering.semester_id,
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
      offering_id: url.searchParams.get('offering_id'),
      year_of_study: url.searchParams.get('year_of_study'),
      // Lecturer scope: restrict to students in offerings the lecturer teaches.
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
    // `offering_ids` (many) replaced the single `section_id` in D29 and was renamed in D31.
    for (const offeringId of body.offering_ids ?? []) {
      const offering = getOffering(offeringId);
      if (!offering) {
        return errorResponse(404, 'offering_not_found', 'Offering not found.');
      }
      if (offering.is_archived) {
        return errorResponse(409, 'year_archived', 'That offering is archived.');
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
      year_of_study: body.year_of_study ?? null,
      // A programme is assigned separately (§D12); a student created here has none.
      program_id: null,
    };
    D.students.push(created);
    for (const offeringId of body.offering_ids ?? []) enrollStudent(created, offeringId);
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
    if (body.year_of_study !== undefined) student.year_of_study = body.year_of_study ?? null;
    // Enrollment is NOT a PATCH field — it moves under Course Offerings → Roster.
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
      const offering = getOffering(enr.offering_id);
      if (offering) enrolled.set(offering.course_id, enr.semester_id);
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
      const course = getCourse(courseId);
      if (!course) continue;
      const pc = planByCourse.get(courseId) ?? null;
      const credits = course.credits ?? 0;

      // The student's result in this course, from whichever offering they sat.
      let letter: string | null = null;
      let numeric: number | null = null;
      // Best result across every OFFERING of the course the student sat — including the
      // same course in two different terms, which is the case D31 made expressible.
      for (const offering of D.offerings.filter((o) => o.course_id === courseId)) {
        const term = computeTermGrade(student.id, offering.id);
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
      .reduce((sum, pc) => sum + (getCourse(pc.course_id)?.credits ?? 0), 0);
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
      // A straight read now: `year_of_study` IS the enum, so there is nothing to coerce.
      year_of_study: student.year_of_study,
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
      // The two BAJC years, matching the column's enum — not free text.
      year_of_study?: DemoStudent['year_of_study'];
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
    if (body.year_of_study) student.year_of_study = body.year_of_study;

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
