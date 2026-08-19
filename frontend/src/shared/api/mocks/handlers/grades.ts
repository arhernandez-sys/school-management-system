import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  assessmentsForClassSubject,
  classSubjectsForYear,
  classSubjectsOwnedByTeacher,
  computeTermGrade,
  getActiveSemester,
  getActiveYear,
  getClassSubject,
  getSection,
  getStudent,
  classSubjectsForStudent,
  getSubject,
  getTeacher,
  gradebookFor,
  letterFor,
} from '@shared/api/mocks/demo/dataset';
import type { DemoAssessment, DemoAssessmentGrade } from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';
import { NUDGE_COOLDOWN_SECONDS, nudgeRetryAfter, recordNudge } from './_nudges';

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
 *  - GET  /grades/class-subjects       — the class_subject picker (role-scoped)
 *  - GET  /grades/class-subject/{id}    — the gradebook read (grid)
 *  - PUT  /assessments/{id}/grades      — bulk grade entry/update (the only write path)
 *  - POST /assessments/{id}/release | /unrelease — release control
 *  - GET  /grades/term                  — computed-on-read term grade(s)
 *  - GET  /grades/me                    — the student's own released grades
 *
 * This file is owned by the Grades agent. Do NOT touch handlers/index.ts.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';

// ── current-user resolution (mirrors auth.ts session-role cookie) ────────────────
// The demo teacher login ("teacher") is Maria Reyes → teach-1; the demo student
// login ("student") is Ana Lopez → stu-1. We resolve the acting profile from the
// role cookie so ownership scoping (teacher sees own class_subjects) works offline.
function sessionRole(cookies: Record<string, string>): string {
  return cookies[SESSION_COOKIE] ?? 'principal';
}
function currentTeacherId(role: string): string | null {
  if (role !== 'teacher') return null;
  // The seeded demo teacher account is the lead on the Mathematics offerings.
  return D.teachers.find((t) => t.user_id === 'user-teach-1')?.id ?? D.teachers[0]?.id ?? null;
}
function currentStudentId(role: string): string | null {
  if (role !== 'student') return null;
  return D.students.find((s) => s.user_id === 'user-stu-1')?.id ?? D.students[0]?.id ?? null;
}

// ── response-shape refs (api-spec §4 lightweight refs) ───────────────────────────
function classSubjectRef(classSubjectId: string) {
  const cs = getClassSubject(classSubjectId);
  if (!cs) return null;
  const section = getSection(cs.section_id);
  const subject = getSubject(cs.subject_id);
  const teachers = cs.teacher_ids
    .map((id) => getTeacher(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({ id: t.id, full_name: t.full_name }));
  return {
    id: cs.id,
    section: section
      ? { id: section.id, name: section.name, grade_level: section.grade_level, section: section.section }
      : null,
    subject: subject ? { id: subject.id, name: subject.name, code: subject.code } : null,
    teachers,
    lead_teacher_id: cs.lead_teacher_id,
    display_name: `${section?.name ?? 'Class'} · ${subject?.name ?? 'Subject'}`,
  };
}

function studentRef(studentId: string) {
  const s = getStudent(studentId);
  if (!s) return { id: studentId, full_name: 'Unknown', student_number: '' };
  return { id: s.id, full_name: s.full_name, student_number: s.student_number };
}

function assessmentSummary(a: DemoAssessment) {
  const gradedCount = D.assessment_grades.filter(
    (g) => g.assessment_id === a.id && g.status === 'graded' && g.score != null,
  ).length;
  const enteredCount = D.assessment_grades.filter(
    (g) => g.assessment_id === a.id && g.status !== 'pending',
  ).length;
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    category_id: a.category_id,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    status: a.status,
    is_released: a.is_released,
    // Whether cells for this column are editable in the gradebook: only assessments
    // that are being graded (published/grading/graded) accept entry, never drafts.
    is_editable: a.status !== 'draft',
    graded_count: gradedCount,
    entered_count: enteredCount,
  };
}

// The active-semester ref (single active term in the demo).
function activeSemesterRef() {
  const sem = D.semesters.find((s) => s.is_active);
  return sem ? { id: sem.id, name: sem.name, sequence: sem.sequence } : null;
}

// ── the gradebook read payload ───────────────────────────────────────────────────
function gradebookResponse(classSubjectId: string) {
  const gb = gradebookFor(classSubjectId);
  const csRef = classSubjectRef(classSubjectId);
  const categories = D.assessment_categories
    .filter((c) => c.class_subject_id === classSubjectId)
    .map((c) => ({ id: c.id, name: c.name, weight: c.weight, drop_lowest_count: c.drop_lowest_count }));
  const cs = getClassSubject(classSubjectId);
  return {
    class_subject: csRef,
    semester: activeSemesterRef(),
    assessments: gb.assessments.map(assessmentSummary),
    categories,
    rows: gb.rows.map((row) => ({
      student: studentRef(row.student.id),
      enrollment_id: row.enrollment_id,
      is_active_member: row.is_active_member,
      cells: row.cells,
      term_numeric: row.term_numeric,
      term_letter: row.term_letter,
    })),
    drop_lowest_applied: (cs?.drop_lowest_count ?? 0) > 0,
  };
}

/**
 * The active term's grade-submission window (D30 §D6), mirroring
 * `grades/service._grade_window_closed`.
 *
 * A null deadline never closes — the state of every demo term as shipped, and the safe
 * default. Demo mode has to carry this rule too: the last two times a rule lived in only
 * one of the two implementations, demo mode certified a screen the real backend refused.
 */
function gradeWindow(): { closed: boolean; deadline: string | null } {
  const deadline = getActiveSemester()?.grade_submission_deadline ?? null;
  if (!deadline) return { closed: false, deadline: null };
  const at = new Date(deadline).getTime();
  // DEMO_TODAY, not the real clock: the dataset is deterministic by design, and reading
  // `Date.now()` here would make the window flip depending on when the demo is opened.
  return { closed: !Number.isNaN(at) && new Date(DEMO_TODAY_ISO).getTime() > at, deadline };
}

// ── grade-entry validation + upsert (PUT /assessments/{id}/grades) ───────────────
interface GradeEntryBody {
  student_id: string;
  status: DemoAssessmentGrade['status'];
  score?: number | null;
  makeup_score?: number | null;
}

export const gradesHandlers = [
  // ── Class-subject picker (which gradebooks the caller may open) ────────────────
  // Teacher → own offerings; Principal/Secretary → all active offerings.
  http.get(`${API_BASE_URL}/grades/class-subjects`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const teacherId = currentTeacherId(role);
    // Per-module year switcher: scope the offerings to the chosen year (default active).
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const yearCsIds = yearId ? new Set(classSubjectsForYear(yearId).map((c) => c.id)) : null;
    let offerings = teacherId
      ? classSubjectsOwnedByTeacher(teacherId)
      : yearId
        ? classSubjectsForYear(yearId)
        : D.class_subjects.filter((c) => c.is_active);
    if (teacherId && yearCsIds) offerings = offerings.filter((c) => yearCsIds.has(c.id));
    const items = offerings
      .map((cs) => {
        const ref = classSubjectRef(cs.id);
        if (!ref) return null;
        const asmts = assessmentsForClassSubject(cs.id);
        return {
          ...ref,
          assessment_count: asmts.length,
          // Whether the CURRENT caller may enter grades here (teacher owns it).
          can_edit: role === 'teacher' && teacherId != null && cs.teacher_ids.includes(teacherId),
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return HttpResponse.json({ items });
  }),

  // ── The gradebook read ─────────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/class-subject/:classSubjectId`, ({ params, cookies }) => {
    const classSubjectId = String(params.classSubjectId);
    const cs = getClassSubject(classSubjectId);
    if (!cs) return errorResponse(404, 'not_found', 'Gradebook not found.');

    const role = sessionRole(cookies);
    const teacherId = currentTeacherId(role);
    // Teachers may only open gradebooks they own (assert_teacher_owns_class_subject).
    if (role === 'teacher' && teacherId != null && !cs.teacher_ids.includes(teacherId)) {
      return errorResponse(404, 'not_found', 'Gradebook not found.');
    }
    const body = gradebookResponse(classSubjectId);
    // Expose whether THIS caller may write (drives read-only P/S view).
    const canEdit = role === 'teacher' && teacherId != null && cs.teacher_ids.includes(teacherId);
    // Reported for EVERY viewer, not just writers: a Registrar asked why the lecturer
    // cannot enter grades needs to see the same closed window (D30 §D6).
    const window = gradeWindow();
    return HttpResponse.json({
      ...body,
      can_edit: canEdit,
      grade_window_closed: window.closed,
      grade_submission_deadline: window.deadline,
      viewer_role: role,
    });
  }),

  // ── Grade entry / update — the ONLY grade-write path ───────────────────────────
  http.put(`${API_BASE_URL}/assessments/:assessmentId/grades`, async ({ params, request, cookies }) => {
    const assessmentId = String(params.assessmentId);
    const asmt = D.assessments.find((a) => a.id === assessmentId);
    if (!asmt) return errorResponse(404, 'not_found', 'Assessment not found.');

    const cs = getClassSubject(asmt.class_subject_id);
    if (!cs) return errorResponse(404, 'not_found', 'Class subject not found.');

    // A teacher may only write grades for offerings they are assigned to
    // (assert_teacher_owns_class_subject) — mirrors the gradebook read guard so the
    // new per-assessment grading page can't be used to write into an un-owned class.
    const writerRole = sessionRole(cookies);
    const writerTeacherId = currentTeacherId(writerRole);
    if (writerRole === 'teacher' && writerTeacherId != null && !cs.teacher_ids.includes(writerTeacherId)) {
      return errorResponse(403, 'forbidden', 'You are not assigned to this class.');
    }

    // The grade-submission deadline (D30 §D6). Checked BEFORE any validation or mutation,
    // exactly where the server checks it, so a refused batch leaves the gradebook
    // untouched. The Dean is exempt — and, as on the server, that arm is unreachable in
    // practice because a Dean fails the ownership guard above anyway; the intended
    // post-deadline path is Phase 5's grade-revision workflow.
    if (writerRole !== 'principal') {
      const window = gradeWindow();
      if (window.closed) {
        return errorResponse(
          409,
          'grade_window_closed',
          'The grade submission deadline for this term has passed.',
        );
      }
    }

    const payload = (await request.json()) as { entries?: GradeEntryBody[] };
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];

    // Active-member set: grade entry is allowed ONLY for actively enrolled students.
    const activeIds = new Set(
      D.enrollments
        .filter((e) => e.section_id === cs.section_id && !e.unenrolled_at)
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
        'One or more students are not actively enrolled in this section.',
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
          (e) => e.student_id === entry.student_id && e.section_id === cs.section_id && !e.unenrolled_at,
        );
        D.assessment_grades.push({
          id: `grd-new-${assessmentId}-${entry.student_id}`,
          assessment_id: assessmentId,
          student_id: entry.student_id,
          enrollment_id: enr?.id ?? '',
          status: entry.status,
          score: nextScore,
          makeup_score: nextMakeup,
          is_released: null,
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

  // ── Release control (per-assessment; whole-column in the demo) ─────────────────
  http.post(`${API_BASE_URL}/assessments/:assessmentId/release`, ({ params }) => {
    const asmt = D.assessments.find((a) => a.id === String(params.assessmentId));
    if (!asmt) return errorResponse(404, 'not_found', 'Assessment not found.');
    asmt.is_released = true;
    const releasedCount = D.assessment_grades.filter((g) => g.assessment_id === asmt.id).length;
    return HttpResponse.json({ assessment_id: asmt.id, is_released: true, released_count: releasedCount });
  }),
  http.post(`${API_BASE_URL}/assessments/:assessmentId/unrelease`, ({ params }) => {
    const asmt = D.assessments.find((a) => a.id === String(params.assessmentId));
    if (!asmt) return errorResponse(404, 'not_found', 'Assessment not found.');
    asmt.is_released = false;
    const releasedCount = D.assessment_grades.filter((g) => g.assessment_id === asmt.id).length;
    return HttpResponse.json({ assessment_id: asmt.id, is_released: false, released_count: releasedCount });
  }),

  // ── Nudge: remind the teacher to release (principal/secretary) ─────────────────
  // Mirrors the backend's refusal order exactly (assessments/service.py::nudge_release):
  // 403 role gate → 404 unknown → 409 no_assigned_teacher → 409 nothing_awaiting_release
  // → 429 rate_limited. Getting the ORDER right matters: the UI distinguishes these.
  http.post(`${API_BASE_URL}/assessments/:assessmentId/nudge-release`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot send release reminders.');
    }
    const asmt = D.assessments.find((a) => a.id === String(params.assessmentId));
    if (!asmt) return errorResponse(404, 'not_found', 'Assessment not found.');

    const cs = getClassSubject(asmt.class_subject_id);
    const teachers = (cs?.teacher_ids ?? [])
      .map((id) => getTeacher(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({ id: t.id, full_name: t.full_name }));
    if (teachers.length === 0) {
      return errorResponse(
        409,
        'no_assigned_teacher',
        'This subject offering has no assigned teacher to remind.',
      );
    }

    // "Marked but still hidden" — same predicate as graded_unreleased_clause():
    // the grade row was explicitly unreleased, or it defers (null) and the whole
    // column is unreleased. `graded` (not merely present) is what makes it awaiting
    // RELEASE rather than awaiting MARKING.
    const awaiting = D.assessment_grades.filter(
      (g) =>
        g.assessment_id === asmt.id &&
        g.status === 'graded' &&
        (g.is_released === false || (g.is_released == null && !asmt.is_released)),
    ).length;
    if (awaiting === 0) {
      return errorResponse(
        409,
        'nothing_awaiting_release',
        'Nothing is awaiting release for this assessment.',
      );
    }

    const retryAfter = nudgeRetryAfter(asmt.id);
    if (retryAfter > 0) {
      return errorResponse(
        429,
        'rate_limited',
        'This teacher was reminded recently. Try again later.',
        { retry_after_seconds: [String(retryAfter)] },
      );
    }

    const at = recordNudge(asmt.id);
    return HttpResponse.json({
      assessment_id: asmt.id,
      awaiting_release_count: awaiting,
      teachers,
      last_nudged_at: at,
      next_nudge_allowed_at: new Date(
        new Date(at).getTime() + NUDGE_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
      cooldown_seconds: NUDGE_COOLDOWN_SECONDS,
    });
  }),

  // ── Computed-on-read term grade(s) ─────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/term`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    const role = sessionRole(cookies);
    const classSubjectId = url.searchParams.get('class_subject_id');

    // Student self-scope: term grade per subject in their section (released only).
    if (scope === 'me' || role === 'student') {
      const studentId = currentStudentId(role) ?? url.searchParams.get('student_id');
      if (!studentId) return errorResponse(404, 'not_found', 'Student not found.');
      // D29: one term grade per subject class the student takes.
      const offerings = classSubjectsForStudent(studentId).filter((c) => c.is_active);
      const items = offerings.map((cs) => {
        const term = computeTermGrade(studentId, cs.id);
        return {
          student: studentRef(studentId),
          class_subject: classSubjectRef(cs.id),
          semester: activeSemesterRef(),
          numeric: term.numeric,
          letter: term.letter,
          weight_base_used: term.weight_base_used,
          is_frozen: false,
        };
      });
      return HttpResponse.json({ items });
    }

    // Teacher / P/S: a single class_subject's term grades for the whole roster.
    if (classSubjectId) {
      const gb = gradebookFor(classSubjectId);
      const items = gb.rows.map((row) => ({
        student: studentRef(row.student.id),
        class_subject: classSubjectRef(classSubjectId),
        semester: activeSemesterRef(),
        numeric: row.term_numeric,
        letter: row.term_letter,
        is_frozen: false,
      }));
      return HttpResponse.json({ items });
    }

    return HttpResponse.json({ items: [] });
  }),

  // ── Student "My Grades" (released only) ────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const studentId = currentStudentId(role) ?? currentStudentId('student');
    if (!studentId) return errorResponse(404, 'not_found', 'Student profile not found.');
    // Global student year switcher: resolve the CLASSES the student sat that year (D29 —
    // there is no single section). Past-year offerings are inactive, so scope by class
    // membership rather than is_active.
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    // Narrows within the year — the switcher now picks a year·semester pair, so both the
    // listed rows AND the term average below must come from the same semester (see the
    // note on computeReleasedTermGrade).
    const semesterId = url.searchParams.get('semester_id');
    // No `is_active` filter — a past year's offerings are all inactive by design, and the
    // year switcher must still render them (the trap documented above).
    const offerings = classSubjectsForStudent(studentId, yearId);

    const bySubject = offerings.map((cs) => {
      const csRef = classSubjectRef(cs.id);
      const lead = cs.lead_teacher_id ? getTeacher(cs.lead_teacher_id) : undefined;
      const asmts = assessmentsForClassSubject(cs.id).filter(
        (a) => !semesterId || a.semester_id === semesterId,
      );
      const assessments = asmts
        .map((a) => {
          const g = D.assessment_grades.find(
            (row) => row.assessment_id === a.id && row.student_id === studentId,
          );
          // grade_release_filter: exclude unreleased assessments entirely.
          const released = g?.is_released ?? a.is_released;
          if (!released) return null;
          // Also only surface results that carry a real result (graded/absent/excused).
          if (!g || g.status === 'pending') return null;
          return {
            assessment_id: a.id,
            title: a.title,
            type: a.type,
            max_score: a.max_score,
            assessment_date: a.assessment_date,
            status: g.status,
            score: g.status === 'graded' ? g.score : null,
            ...(g.status === 'graded' && g.score != null
              ? { letter: letterFor((g.score / a.max_score) * 100) }
              : {}),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      // Term numeric from released, graded assessments only (student-facing) — and from
      // the SAME semester as the rows above, so the average is derivable from what the
      // student can see rather than silently spanning the whole year.
      const term = computeReleasedTermGrade(studentId, cs.id, semesterId);
      return {
        class_subject: csRef,
        teacher: lead ? { id: lead.id, full_name: lead.full_name } : null,
        assessments,
        term_numeric: term.numeric,
        term_letter: term.letter,
      };
    });

    return HttpResponse.json({ student: studentRef(studentId), by_subject: bySubject });
  }),
];

/**
 * A student-facing term grade: like computeTermGrade but only released, graded
 * assessments contribute (grade_release_filter on the score). Kept local to the
 * handler so the selector stays release-agnostic (teachers/admins see everything).
 *
 * `semesterId` must be the same one used to build the listed rows. The whole point of a
 * per-semester view is that the average describes what is on screen: averaging the year
 * while listing one term would print a number the student cannot derive from their own
 * marks. The backend gets this for free (one `_assessments_for` call feeds both); here
 * the filter has to be passed to both places explicitly.
 */
function computeReleasedTermGrade(
  studentId: string,
  classSubjectId: string,
  semesterId?: string | null,
): { numeric: number | null; letter: string | null } {
  const asmts = assessmentsForClassSubject(classSubjectId)
    .filter((a) => a.status === 'graded')
    .filter((a) => !semesterId || a.semester_id === semesterId);
  let weightedSum = 0;
  let weightBase = 0;
  for (const a of asmts) {
    const g = D.assessment_grades.find(
      (row) => row.assessment_id === a.id && row.student_id === studentId,
    );
    if (!g) continue;
    const released = g.is_released ?? a.is_released;
    if (!released) continue;
    if (g.status !== 'graded' || g.score == null) continue;
    const pct = (g.score / a.max_score) * 100;
    weightedSum += pct * a.weight;
    weightBase += a.weight;
  }
  if (weightBase === 0) return { numeric: null, letter: null };
  const numeric = Math.round((weightedSum / weightBase) * 100) / 100;
  return { numeric, letter: letterFor(numeric) };
}
