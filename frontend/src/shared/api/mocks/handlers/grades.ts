import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  assessmentsForOffering,
  computeTermGrade,
  demoHodOfferingIds,
  getActiveSemester,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  getTeacher,
  gradebookFor,
  isAutoZero,
  isMarkingOpen,
  lecturerOfferingIds,
  lecturerOwnsOffering,
  letterFor,
  markingStateFor,
  offeringLabel,
  offeringsForStudent,
  offeringsForYear,
  pendingReopenFor,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAssessment,
  DemoAssessmentGrade,
  DemoOffering,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for the GRADES module (api-spec §5 Module 7) — DEMO.
 *
 * Backs the marquee Gradebook screen + the student "My Grades" view with the shared
 * in-memory demo dataset so numbers reconcile across every screen. All reads derive
 * from the selectors (`gradebookFor`, `computeTermGrade`, `letterFor`); grade WRITES
 * mutate `DEMO_DATASET.assessment_grades` in place and the next gradebook read
 * recomputes term grades (compute-on-read, architecture §7.1).
 *
 * Endpoints implemented:
 *  - GET  /grades/offerings           — the gradebook picker (role-scoped)
 *  - GET  /grades/offering/{id}       — the gradebook read (grid)
 *  - GET  /grades/assessment-report   — the printable assessment report (D47)
 *  - PUT  /assessments/{id}/grades    — bulk grade entry/update (the only write path)
 *  - GET  /grades/term                — computed-on-read term grade(s)
 *  - GET  /grades/me                  — the student's own grades
 *
 * **D47 — no publish/release lifecycle.** `/release`, `/unrelease` and `/nudge-release`
 * are gone, as on the server. A saved mark counts the moment it is saved; each assessment
 * has a 5-day MARKING WINDOW instead (`selectors.markingStateFor`, the mock mirror of
 * `assessments/marking.py`). Once it closes, a save is a 409 `marking_closed` and a blank
 * counts as 0 (`auto_zero`). The way back in is a reopen request (`handlers/reopens.ts`).
 *
 * **Scoping mirrors `grades/service._assert_readable`.** A Lecturer reads and edits the
 * offerings they teach; a head of department ALSO reads (never edits) their programme's;
 * the Dean and the Auditor read everything; anyone else is refused at the role gate. Both
 * lecturer roles resolve through `currentDemoLecturer`, the one resolver every handler uses
 * — before D47 this file resolved the `teacher` login only, so a head owned nothing here.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';

/** `_staff` on the grades router: who may open a gradebook or the picker at all. */
const STAFF_ROLES = new Set(['teacher', 'hod', 'principal', 'auditor']);
/** `_report` — the printable assessment report. */
const REPORT_ROLES = new Set(['principal', 'teacher', 'hod']);
const LECTURER_ROLES = new Set(['teacher', 'hod']);

function sessionRole(cookies: Record<string, string>): string {
  return cookies[SESSION_COOKIE] ?? 'principal';
}
function currentStudentId(role: string): string | null {
  if (role !== 'student') return null;
  return D.students.find((s) => s.user_id === 'user-stu-1')?.id ?? D.students[0]?.id ?? null;
}

/** `offerings.queries.offering_session_active` — only the active term can change. */
function offeringSessionActive(offering: DemoOffering): boolean {
  return getSemester(offering.semester_id)?.is_active === true;
}

/**
 * `grades/service._assert_readable` + `offering_session_active`: may this caller READ the
 * gradebook, and may they WRITE it? `null` means 404 — an offering a Lecturer may not see
 * answers exactly like one that does not exist.
 */
function gradebookAccess(role: string, offering: DemoOffering): { canEdit: boolean } | null {
  const owns = lecturerOwnsOffering(role, offering);
  if (role === 'teacher') {
    return owns ? { canEdit: offeringSessionActive(offering) } : null;
  }
  if (role === 'hod') {
    // D43 — teaching it wins first; heading its programme buys READ and nothing more.
    if (owns) return { canEdit: offeringSessionActive(offering) };
    if (demoHodOfferingIds(role).includes(offering.id)) return { canEdit: false };
    return null;
  }
  return { canEdit: false };
}

// ── response-shape refs (api-spec §4 lightweight refs) ───────────────────────────
/**
 * The Grades module's offering ref: the SHARED `OfferingRef` plus the staffing this module
 * genuinely needs (the picker names its lecturer, and `can_edit` is judged against them).
 *
 * `teachers[].full_name` stays — grades names its lecturers rather than administering them,
 * so it keeps the `{ id, full_name }` shape and omits the directory's `staff_number`.
 */
function offeringRef(offeringId: string) {
  const offering = getOffering(offeringId);
  if (!offering) return null;
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  const teachers = offering.teacher_ids
    .map((id) => getTeacher(id))
    .filter((tt): tt is NonNullable<typeof tt> => Boolean(tt))
    .map((tt) => ({ id: tt.id, full_name: tt.full_name }));
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
    teachers,
    lead_teacher_id: offering.lead_teacher_id,
  };
}

function studentRef(studentId: string) {
  const s = getStudent(studentId);
  if (!s) return { id: studentId, full_name: 'Unknown', student_number: '' };
  return { id: s.id, full_name: s.full_name, student_number: s.student_number };
}

/**
 * One gradebook column (`GradebookAssessment`). The window comes from the one selector;
 * `can_request_reopen` is the server's rule verbatim: the caller may EDIT this offering
 * (owning lecturer, live session), the window is closed, and nothing is already pending.
 */
function assessmentColumn(a: DemoAssessment, mayRequestReopen: boolean) {
  const grades = D.assessment_grades.filter((g) => g.assessment_id === a.id);
  const st = markingStateFor(a);
  const pending = pendingReopenFor(a.id);
  return {
    id: a.id,
    title: a.title,
    category_id: a.category_id,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    graded_count: grades.filter((g) => g.status === 'graded' && g.score != null).length,
    entered_count: grades.filter((g) => g.status !== 'pending').length,
    marking_open: st.open,
    marking_closes_at: st.closes_at,
    reopened_until: st.reopened_until,
    effective_closes_at: st.effective_closes_at,
    days_left: st.days_left,
    can_request_reopen: mayRequestReopen && !st.open && !pending,
    pending_reopen_request_id: pending?.id ?? null,
  };
}

/**
 * The term a gradebook is scoped to — the OFFERING's own semester, not "the active one".
 * Shape is `{ id, name, sequence }` with no `is_active`.
 */
function semesterRefOf(offeringId: string) {
  const offering = getOffering(offeringId);
  const sem = offering ? getSemester(offering.semester_id) : undefined;
  return sem ? { id: sem.id, name: sem.name, sequence: sem.sequence } : null;
}

/**
 * The active term's MID-TERM FREEZE (D33, client ask 7), mirroring
 * `grades/service.midterm_freeze_state`. Both bounds INCLUSIVE; DEMO_TODAY, not the clock.
 */
function midtermFreeze(): { frozen: boolean; start: string | null; end: string | null } {
  const sem = getActiveSemester();
  const start = sem?.midterm_submission_start ?? null;
  const end = sem?.midterm_submission_end ?? null;
  if (!start || !end) return { frozen: false, start: null, end: null };
  const now = new Date(DEMO_TODAY_ISO).getTime();
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return { frozen: false, start, end };
  return { frozen: now >= from && now <= to, start, end };
}

/**
 * The whole `Gradebook` payload for one caller — shared by the gradebook read and the
 * printable report, which the server builds FROM `get_gradebook` so paper and screen agree.
 */
function gradebookPayload(offering: DemoOffering, role: string, canEdit: boolean) {
  const gb = gradebookFor(offering.id);
  const categories = D.assessment_categories
    .filter((c) => c.offering_id === offering.id)
    .map((c) => ({ id: c.id, name: c.name, weight: c.weight, drop_lowest_count: c.drop_lowest_count }));
  // Only the owning lecturer may ask; `can_edit` already means "owner, live session".
  const mayRequestReopen = canEdit && LECTURER_ROLES.has(role);
  // D32 — `can_request_revision` answers "may YOU file one", and only a Lecturer can. The
  // selector has no caller identity, so the zeroing happens here, mirroring
  // `get_gradebook`'s `viewer_is_lecturer` guard (role TEACHER only, as on the server).
  const viewerIsLecturer = role === 'teacher';
  const freeze = midtermFreeze();
  return {
    offering: offeringRef(offering.id),
    semester: semesterRefOf(offering.id),
    assessments: gb.assessments.map((a) => assessmentColumn(a, mayRequestReopen)),
    categories,
    rows: gb.rows.map((row) => ({
      student: studentRef(row.student.id),
      enrollment_id: row.enrollment_id,
      is_active_member: row.is_active_member,
      cells: viewerIsLecturer
        ? row.cells
        : row.cells.map((c) => ({ ...c, can_request_revision: false, revision_blocked_reason: null })),
      term_numeric: row.term_numeric,
      term_letter: row.term_letter,
    })),
    drop_lowest_applied: (offering.drop_lowest_count ?? 0) > 0,
    can_edit: canEdit,
    // D42 §5 — constants, matching the server.
    grade_window_closed: false,
    grade_submission_deadline: null,
    // D33 — reported for EVERY viewer, not just the one who can write.
    midterm_frozen: freeze.frozen,
    midterm_submission_start: freeze.start,
    midterm_submission_end: freeze.end,
    viewer_role: role,
  };
}

/** Course code then section code — `OFFERING_ORDER`, never the formatted label. */
function compareByCode(a: DemoOffering, b: DemoOffering): number {
  return (
    (getCourse(a.course_id)?.code ?? '').localeCompare(getCourse(b.course_id)?.code ?? '') ||
    (a.section_code ?? '').localeCompare(b.section_code ?? '')
  );
}

/** At most this many offerings in one printed report (`assessment_report.MAX_OFFERINGS`). */
const REPORT_MAX_OFFERINGS = 60;

/** `assessment_report._active_semester_id`. */
function activeSemesterId(): string | null {
  return getActiveSemester()?.id ?? null;
}

// ── grade-entry validation + upsert (PUT /assessments/{id}/grades) ───────────────
interface GradeEntryBody {
  student_id: string;
  status: DemoAssessmentGrade['status'];
  score?: number | null;
  makeup_score?: number | null;
}

export const gradesHandlers = [
  // ── Offering picker (which gradebooks the caller may open) ─────────────────────
  // Lecturer → own offerings; HOD → own + programme (editable only the own ones);
  // Dean/Auditor → every offering of the year. `can_edit` also needs the live session.
  http.get(`${API_BASE_URL}/grades/offerings`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    if (!STAFF_ROLES.has(role)) {
      return errorResponse(403, 'forbidden', 'You do not have access to gradebooks.');
    }
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const inYear = yearId ? offeringsForYear(yearId) : D.offerings.filter((o) => !o.is_archived);
    const owned = new Set(lecturerOfferingIds(role));
    const visible =
      role === 'teacher'
        ? owned
        : role === 'hod'
          ? new Set([...owned, ...demoHodOfferingIds(role)])
          : null;
    const activeSem = activeSemesterId();
    const items = inYear
      .filter((o) => visible === null || visible.has(o.id))
      .slice()
      .sort(compareByCode)
      .map((offering) => {
        const ref = offeringRef(offering.id);
        if (!ref) return null;
        return {
          ...ref,
          assessment_count: assessmentsForOffering(offering.id).length,
          can_edit: owned.has(offering.id) && offering.semester_id === activeSem,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    return HttpResponse.json({ items });
  }),

  // ── The printable assessment report (D47) ──────────────────────────────────────
  // Declared BEFORE `/grades/offering/:id` for readability only — the paths cannot collide.
  // Mirrors `grades/assessment_report.build_report`: a lecturer (or HOD) gets ONLY the
  // offerings they teach, `teacher_id` is ignored for them, and an explicitly named offering
  // they do not teach is a 404. No term/year/offering/student → the active session.
  http.get(`${API_BASE_URL}/grades/assessment-report`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    if (!REPORT_ROLES.has(role)) {
      return errorResponse(403, 'forbidden', 'You do not have access to the assessment report.');
    }
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id');
    let semesterId = url.searchParams.get('semester_id');
    const offeringId = url.searchParams.get('offering_id');
    const studentId = url.searchParams.get('student_id');
    const teacherId = url.searchParams.get('teacher_id');

    let rows = D.offerings.slice();
    if (LECTURER_ROLES.has(role)) {
      const owned = new Set(lecturerOfferingIds(role));
      if (offeringId && !owned.has(offeringId)) {
        return errorResponse(404, 'not_found', 'Offering not found.');
      }
      rows = rows.filter((o) => owned.has(o.id));
    } else if (teacherId) {
      rows = rows.filter((o) => o.teacher_ids.includes(teacherId));
    }
    if (offeringId) rows = rows.filter((o) => o.id === offeringId);
    if (studentId) {
      const sat = new Set(
        D.enrollments
          .filter((e) => e.student_id === studentId && !e.unenrolled_at)
          .map((e) => e.offering_id),
      );
      rows = rows.filter((o) => sat.has(o.id));
    }
    if (!semesterId && !yearId && !offeringId && !studentId) semesterId = activeSemesterId();
    if (semesterId) rows = rows.filter((o) => o.semester_id === semesterId);
    if (yearId) {
      const inYear = new Set(offeringsForYear(yearId).map((o) => o.id));
      rows = rows.filter((o) => inYear.has(o.id));
    }
    rows.sort(compareByCode);

    const sections = rows.slice(0, REPORT_MAX_OFFERINGS).map((offering) => {
      const access = gradebookAccess(role, offering);
      const book = gradebookPayload(offering, role, access?.canEdit ?? false);
      const catName = new Map(book.categories.map((c) => [c.id, c.name]));
      return {
        offering: book.offering,
        semester: book.semester,
        assessments: book.assessments.map((a) => ({
          id: a.id,
          title: a.title,
          category_name: a.category_id ? (catName.get(a.category_id) ?? null) : null,
          assessment_date: a.assessment_date,
          max_score: a.max_score,
          marking_open: a.marking_open,
          effective_closes_at: a.effective_closes_at,
        })),
        rows: book.rows
          .filter((r) => r.is_active_member && (!studentId || r.student.id === studentId))
          .map((r) => ({
            student: r.student,
            cells: r.cells,
            term_numeric: r.term_numeric,
            term_letter: r.term_letter,
          })),
      };
    });

    return HttpResponse.json({
      generated_at: DEMO_TODAY_ISO,
      total_offerings: rows.length,
      truncated: rows.length > REPORT_MAX_OFFERINGS,
      offerings: sections,
    });
  }),

  // ── The gradebook read ─────────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/offering/:offeringId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (!STAFF_ROLES.has(role)) {
      return errorResponse(403, 'forbidden', 'You do not have access to gradebooks.');
    }
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'not_found', 'Gradebook not found.');
    const access = gradebookAccess(role, offering);
    // 404, not 403 — an unowned-but-real gradebook answers exactly like a nonexistent one.
    if (!access) return errorResponse(404, 'not_found', 'Resource not found.');
    return HttpResponse.json(gradebookPayload(offering, role, access.canEdit));
  }),

  // ── Grade entry / update — the ONLY grade-write path ───────────────────────────
  // Guard order mirrors `grades/service.upsert_grades`: role gate (403) → assessment
  // (404) → ownership (404) → live session (409) → mid-term freeze (409) → MARKING
  // WINDOW (409 `marking_closed`, D47) → per-entry validation (422).
  http.put(`${API_BASE_URL}/assessments/:assessmentId/grades`, async ({ params, request, cookies }) => {
    const role = sessionRole(cookies);
    if (!LECTURER_ROLES.has(role)) {
      return errorResponse(403, 'forbidden', 'Only the lecturer may enter grades.');
    }
    const assessmentId = String(params.assessmentId);
    const asmt = D.assessments.find((a) => a.id === assessmentId);
    if (!asmt) return errorResponse(404, 'not_found', 'Assessment not found.');

    const offering = getOffering(asmt.offering_id);
    if (!offering || !lecturerOwnsOffering(role, offering)) {
      return errorResponse(404, 'not_found', 'Resource not found.');
    }
    if (!offeringSessionActive(offering)) {
      return errorResponse(
        409,
        'session_inactive',
        'This session is not active. Its assessments and grades are read-only.',
      );
    }

    // D33 ask 7 — the mid-session freeze, checked before any validation or mutation.
    const freeze = midtermFreeze();
    if (freeze.frozen) {
      return errorResponse(
        409,
        'midterm_frozen',
        'The mid-session grading period is in progress, so grades for this session are frozen. ' +
          'Entry reopens once the period closes.',
      );
    }

    // D47 — `_assert_marking_open`. No role is exempt; the way back in is a reopen request
    // the Dean approves. The 409 names the instant it closed, as a top-level `closed_at`.
    const window = markingStateFor(asmt);
    if (!window.open) {
      return HttpResponse.json(
        {
          error: {
            code: 'marking_closed',
            message:
              'The marking window for this assessment has closed. Ask the Dean to reopen it ' +
              'to enter or change marks.',
            closed_at: window.effective_closes_at,
          },
        },
        { status: 409 },
      );
    }

    const payload = (await request.json()) as { entries?: GradeEntryBody[] };
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];

    // Active-member set: grade entry is allowed ONLY for actively enrolled students.
    const activeIds = new Set(
      D.enrollments
        .filter((e) => e.offering_id === offering.id && !e.unenrolled_at)
        .map((e) => e.student_id),
    );

    // Validate every entry BEFORE mutating (all-or-nothing per request).
    const notEnrolled: string[] = [];
    const scoreOffenders: string[] = [];
    for (const entry of entries) {
      if (!activeIds.has(entry.student_id)) {
        notEnrolled.push(entry.student_id);
        continue;
      }
      if (entry.status === 'graded') {
        const s = entry.score;
        if (typeof s !== 'number' || Number.isNaN(s) || s < 0 || s > asmt.max_score) {
          scoreOffenders.push(entry.student_id);
        }
      }
      if (entry.makeup_score != null) {
        if (entry.status !== 'absent') {
          return errorResponse(422, 'makeup_not_allowed', 'Makeup score applies only to an absent result.');
        }
        if (!D.assessment_policy.allow_makeup) {
          return errorResponse(422, 'makeup_not_allowed', 'Makeups are disabled by the grading policy.');
        }
        if (entry.makeup_score < 0 || entry.makeup_score > asmt.max_score) {
          scoreOffenders.push(entry.student_id);
        }
      }
    }
    if (notEnrolled.length > 0) {
      return errorResponse(
        422,
        'student_not_enrolled',
        'One or more students are not actively enrolled in this offering.',
        { student_id: notEnrolled },
      );
    }
    if (scoreOffenders.length > 0) {
      return errorResponse(
        422,
        'score_exceeds_max',
        `Score must be between 0 and ${asmt.max_score}.`,
        { student_id: scoreOffenders },
      );
    }

    // Upsert on (assessment_id, student_id).
    const updated = entries.map((entry) => {
      const existing = D.assessment_grades.find(
        (g) => g.assessment_id === assessmentId && g.student_id === entry.student_id,
      );
      const nextScore = entry.status === 'graded' ? (entry.score ?? null) : null;
      const nextMakeup = entry.status === 'absent' ? (entry.makeup_score ?? null) : null;
      if (existing) {
        existing.status = entry.status;
        existing.score = nextScore;
        existing.makeup_score = nextMakeup;
      } else {
        const enr = D.enrollments.find(
          (e) =>
            e.student_id === entry.student_id &&
            e.offering_id === offering.id &&
            !e.unenrolled_at,
        );
        D.assessment_grades.push({
          id: `grd-new-${assessmentId}-${entry.student_id}`,
          assessment_id: assessmentId,
          student_id: entry.student_id,
          enrollment_id: enr?.id ?? '',
          status: entry.status,
          score: nextScore,
          makeup_score: nextMakeup,
        });
      }
      return {
        student_id: entry.student_id,
        status: entry.status,
        score: nextScore,
        makeup_score: nextMakeup,
        ...(entry.status === 'graded' && nextScore != null
          ? { letter: letterFor((nextScore / asmt.max_score) * 100) }
          : {}),
      };
    });

    return HttpResponse.json({ updated });
  }),

  // ── Computed-on-read term grade(s) ─────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/term`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    const role = sessionRole(cookies);
    const offeringId = url.searchParams.get('offering_id');

    // Student self-scope: one term grade per offering they take. D47 — no release
    // filter: the number is the one the gradebook shows.
    if (scope === 'me' || role === 'student') {
      const studentId = currentStudentId(role) ?? url.searchParams.get('student_id');
      if (!studentId) return errorResponse(404, 'not_found', 'Student not found.');
      const offerings = offeringsForStudent(studentId).filter((o) => !o.is_archived);
      const items = offerings.map((offering) => {
        const term = computeTermGrade(studentId, offering.id);
        return {
          student: studentRef(studentId),
          offering: offeringRef(offering.id),
          // The OFFERING's term, not the school's active one.
          semester: semesterRefOf(offering.id),
          numeric: term.numeric,
          letter: term.letter,
          weight_base_used: term.weight_base_used,
          is_frozen: false,
        };
      });
      return HttpResponse.json({ items });
    }

    // Lecturer / Dean / Registrar: one offering's term grades for the whole roster.
    if (offeringId) {
      const gb = gradebookFor(offeringId);
      const items = gb.rows.map((row) => ({
        student: studentRef(row.student.id),
        offering: offeringRef(offeringId),
        semester: semesterRefOf(offeringId),
        numeric: row.term_numeric,
        letter: row.term_letter,
        is_frozen: false,
      }));
      return HttpResponse.json({ items });
    }

    return HttpResponse.json({ items: [] });
  }),

  // ── Student "My Grades" ────────────────────────────────────────────────────────
  // D47 (`grades/service.get_my_grades`): a mark is visible the moment it is saved. Rows
  // carrying a real result are listed, PLUS every automatic zero — a blank on a closed
  // window — as `status: pending`, `score: null`, `auto_zero: true`, because it counts as
  // 0 in the term average printed beside it.
  http.get(`${API_BASE_URL}/grades/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const studentId = currentStudentId(role) ?? currentStudentId('student');
    if (!studentId) return errorResponse(404, 'not_found', 'Student profile not found.');
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    // Narrows within the year; the listed rows AND the term average below use the same
    // semester, so the average is derivable from what is on screen.
    const semesterId = url.searchParams.get('semester_id');
    // No `is_archived` filter — a past year's offerings are all archived by design.
    const offerings = offeringsForStudent(studentId, yearId);

    const bySubject = offerings.map((offering) => {
      const ref = offeringRef(offering.id);
      const lead = offering.lead_teacher_id ? getTeacher(offering.lead_teacher_id) : undefined;
      const asmts = assessmentsForOffering(offering.id).filter(
        (a) => !semesterId || a.semester_id === semesterId,
      );
      const assessments = asmts
        .map((a) => {
          const g = D.assessment_grades.find(
            (row) => row.assessment_id === a.id && row.student_id === studentId,
          );
          const autoZero = isAutoZero(g, isMarkingOpen(a));
          if (!autoZero && (!g || g.status === 'pending')) return null;
          const score = g?.status === 'graded' ? g.score : null;
          return {
            assessment_id: a.id,
            title: a.title,
            max_score: a.max_score,
            assessment_date: a.assessment_date,
            status: g?.status ?? ('pending' as const),
            score,
            auto_zero: autoZero,
            ...(score != null ? { letter: letterFor((score / a.max_score) * 100) } : {}),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      const term = computeTermGrade(studentId, offering.id, semesterId);
      return {
        offering: ref,
        teacher: lead ? { id: lead.id, full_name: lead.full_name } : null,
        assessments,
        term_numeric: term.numeric,
        term_letter: term.letter,
      };
    });

    return HttpResponse.json({ student: studentRef(studentId), by_subject: bySubject });
  }),
];
