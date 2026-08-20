import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  assessmentsForOffering,
  computeTermGrade,
  getActiveSemester,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  getTeacher,
  gradebookFor,
  letterFor,
  offeringLabel,
  offeringsForStudent,
  offeringsForYear,
  offeringsOwnedByTeacher,
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
 *  - GET  /grades/offerings         — the gradebook picker (role-scoped)
 *  - GET  /grades/offering/{id}     — the gradebook read (grid)
 *  - PUT  /assessments/{id}/grades  — bulk grade entry/update (the only write path)
 *  - POST /assessments/{id}/release | /unrelease — release control
 *  - GET  /grades/term              — computed-on-read term grade(s)
 *  - GET  /grades/me                — the student's own released grades
 *
 * **D31** — the two `/grades/class-subject…` paths named the `class_subjects` join table,
 * which no longer exists, and the gradebook's ref lost its hand-built `display_name` in
 * favour of the server-derived `offering.label`. One offering, one gradebook, one id: the
 * ownership guard that used to be `assert_teacher_owns_class_subject` is now the same
 * question as owning the offering, which is why the two server-side asserts merged.
 *
 * This file is owned by the Grades agent. Do NOT touch handlers/index.ts.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';

// ── current-user resolution (mirrors auth.ts session-role cookie) ────────────────
// The demo teacher login ("teacher") is Maria Reyes → teach-1; the demo student
// login ("student") is Freddy Lopez → stu-1. We resolve the acting profile from the
// role cookie so ownership scoping (a lecturer sees their own offerings) works offline.
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
/**
 * The Grades module's offering ref: the SHARED `OfferingRef` plus the staffing this module
 * genuinely needs (the picker names its lecturer, and `can_edit` is judged against them).
 *
 * Its predecessor was a private `ClassSubjectRef` keyed `id`, carrying a "fat" section ref
 * (`grade_level`, the division letter) and a `display_name` it assembled itself as
 * `"${section.name} · ${subject.name}"`. That was one of the five private derivations of the
 * offering label; there is now exactly one, `offeringLabel`.
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

/**
 * The term a gradebook is scoped to — the OFFERING's own semester, not "the active one".
 *
 * This used to return the school's active semester unconditionally, which was harmless while
 * every offering lived in one year-scoped bucket. It is wrong now: opening the Semester-2
 * offering of a course would have printed "Semester 1" above it.
 *
 * Shape is `{ id, name, sequence }` with no `is_active`: a gradebook is read for archived
 * terms as readily as live ones, so "is this the current term" is not a fact about it.
 */
function semesterRefOf(offeringId: string) {
  const offering = getOffering(offeringId);
  const sem = offering ? getSemester(offering.semester_id) : undefined;
  return sem ? { id: sem.id, name: sem.name, sequence: sem.sequence } : null;
}

// ── the gradebook read payload ───────────────────────────────────────────────────
function gradebookResponse(offeringId: string) {
  const gb = gradebookFor(offeringId);
  const ref = offeringRef(offeringId);
  const categories = D.assessment_categories
    .filter((c) => c.offering_id === offeringId)
    .map((c) => ({ id: c.id, name: c.name, weight: c.weight, drop_lowest_count: c.drop_lowest_count }));
  const offering = getOffering(offeringId);
  return {
    offering: ref,
    semester: semesterRefOf(offeringId),
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
    drop_lowest_applied: (offering?.drop_lowest_count ?? 0) > 0,
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
  // ── Offering picker (which gradebooks the caller may open) ─────────────────────
  // Lecturer → own offerings; Dean/Registrar → every live offering.
  http.get(`${API_BASE_URL}/grades/offerings`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const teacherId = currentTeacherId(role);
    // Per-module year switcher: scope the offerings to the chosen year (default active).
    // The year resolves THROUGH each offering's semester — there is no year column.
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const inYear = yearId ? offeringsForYear(yearId) : D.offerings.filter((o) => !o.is_archived);
    const offerings = teacherId
      ? offeringsOwnedByTeacher(teacherId).filter((o) => inYear.some((y) => y.id === o.id))
      : inYear;
    const items = offerings
      .map((offering) => {
        const ref = offeringRef(offering.id);
        if (!ref) return null;
        return {
          ...ref,
          assessment_count: assessmentsForOffering(offering.id).length,
          // Whether the CURRENT caller may enter grades here (they teach it).
          can_edit:
            role === 'teacher' && teacherId != null && offering.teacher_ids.includes(teacherId),
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      // Ordered by course code then section code, never by the formatted label:
      // "MATH1110-2" would sort before "MATH1110-10".
      .sort(
        (a, b) =>
          (a.offering.course.code ?? '').localeCompare(b.offering.course.code ?? '') ||
          (a.offering.section_code ?? '').localeCompare(b.offering.section_code ?? ''),
      );
    return HttpResponse.json({ items });
  }),

  // ── The gradebook read ─────────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/offering/:offeringId`, ({ params, cookies }) => {
    const offeringId = String(params.offeringId);
    const offering = getOffering(offeringId);
    if (!offering) return errorResponse(404, 'not_found', 'Gradebook not found.');

    const role = sessionRole(cookies);
    const teacherId = currentTeacherId(role);
    // A lecturer may only open gradebooks they teach (`assert_teacher_owns_offering`, which
    // is the merge of the old owns-section and owns-class_subject asserts). 404, not 403 —
    // an unowned-but-real gradebook must answer exactly like a nonexistent one.
    if (role === 'teacher' && teacherId != null && !offering.teacher_ids.includes(teacherId)) {
      return errorResponse(404, 'not_found', 'Gradebook not found.');
    }
    const body = gradebookResponse(offeringId);
    // Expose whether THIS caller may write (drives the read-only Dean/Registrar view).
    const canEdit =
      role === 'teacher' && teacherId != null && offering.teacher_ids.includes(teacherId);
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

    const offering = getOffering(asmt.offering_id);
    if (!offering) return errorResponse(404, 'not_found', 'Offering not found.');

    // A lecturer may only write grades for offerings they teach (`assert_teacher_owns_
    // offering`) — mirrors the gradebook read guard, so the per-assessment grading page
    // cannot be used to write into an offering they do not teach.
    const writerRole = sessionRole(cookies);
    const writerTeacherId = currentTeacherId(writerRole);
    if (
      writerRole === 'teacher' &&
      writerTeacherId != null &&
      !offering.teacher_ids.includes(writerTeacherId)
    ) {
      return errorResponse(403, 'forbidden', 'You do not teach this offering.');
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

    const nudgeOffering = getOffering(asmt.offering_id);
    const teachers = (nudgeOffering?.teacher_ids ?? [])
      .map((id) => getTeacher(id))
      .filter((tt): tt is NonNullable<typeof tt> => Boolean(tt))
      .map((tt) => ({ id: tt.id, full_name: tt.full_name }));
    if (teachers.length === 0) {
      return errorResponse(
        409,
        'no_assigned_teacher',
        'This offering has no assigned lecturer to remind.',
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
    const offeringId = url.searchParams.get('offering_id');

    // Student self-scope: one term grade per offering they take (released only).
    if (scope === 'me' || role === 'student') {
      const studentId = currentStudentId(role) ?? url.searchParams.get('student_id');
      if (!studentId) return errorResponse(404, 'not_found', 'Student not found.');
      const offerings = offeringsForStudent(studentId).filter((o) => !o.is_archived);
      const items = offerings.map((offering) => {
        const term = computeTermGrade(studentId, offering.id);
        return {
          student: studentRef(studentId),
          offering: offeringRef(offering.id),
          // The OFFERING's term, not the school's active one — the row describes work done
          // in a specific semester and may well be a past one.
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

  // ── Student "My Grades" (released only) ────────────────────────────────────────
  http.get(`${API_BASE_URL}/grades/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    const studentId = currentStudentId(role) ?? currentStudentId('student');
    if (!studentId) return errorResponse(404, 'not_found', 'Student profile not found.');
    // Global student year switcher: resolve the OFFERINGS the student sat that year.
    // Past-year offerings are archived, so scope by enrolment rather than by the flag.
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    // Narrows within the year — the switcher now picks a year·semester pair, so both the
    // listed rows AND the term average below must come from the same semester (see the
    // note on computeReleasedTermGrade).
    const semesterId = url.searchParams.get('semester_id');
    // No `is_archived` filter — a past year's offerings are all archived by design, and the
    // year switcher must still render them (the trap documented above).
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
      const term = computeReleasedTermGrade(studentId, offering.id, semesterId);
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
  offeringId: string,
  semesterId?: string | null,
): { numeric: number | null; letter: string | null } {
  const asmts = assessmentsForOffering(offeringId)
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
