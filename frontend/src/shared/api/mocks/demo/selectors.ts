/**
 * DEMO DATASET — selector / helper functions.
 *
 * The ONE place the module agents' handlers and dashboards read from. Every helper
 * derives from `DEMO_DATASET` so numbers reconcile across screens. Grade math
 * (weighted term grade + derived letter) matches the api-spec compute-on-read model
 * (§5.7 / §10) and the D11 grading scale.
 *
 * These are pure reads over the in-memory store. Handlers that need to MUTATE
 * (create/patch a subject, upsert grades, mark-read) should mutate `DEMO_DATASET`'s
 * arrays directly — the store is a plain object, and because the demo is a single
 * browser session that is the intended, deterministic behavior.
 *
 * ⚠️ Module agents: prefer these helpers over re-querying the arrays by hand, so the
 * derivation logic (roster ∪ grade-rows, letter bands, attendance rate) stays in one
 * place and screens stay consistent.
 */
import { DEMO_DATASET, DEMO_IDS, DEMO_TODAY, DEMO_TODAY_ISO } from './data';
import type {
  DemoAcademicYear,
  DemoAssessment,
  DemoAssessmentGrade,
  DemoCourse,
  DemoEnrollment,
  DemoEvent,
  DemoListParams,
  DemoOffering,
  DemoPage,
  DemoStudent,
  DemoTeacher,
} from './types';

const D = DEMO_DATASET;

// ── Generic pagination (api-spec §4.1 / §6) ─────────────────────────────────────
/**
 * Paginate + sort an already-filtered array. `sort` is "field" (asc) or "-field"
 * (desc); an `id` tiebreaker keeps pages stable. `page` is 1-based; `page_size`
 * clamps to [1, 100]. Returns the `Page[T]` envelope shape.
 */
export function paginate<T extends Record<string, unknown>>(
  items: T[],
  params: DemoListParams = {},
): DemoPage<T> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 25));

  let sorted = items;
  if (params.sort) {
    const desc = params.sort.startsWith('-');
    const field = desc ? params.sort.slice(1) : params.sort;
    sorted = [...items].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      if (cmp === 0) cmp = String(a.id ?? '').localeCompare(String(b.id ?? ''));
      return desc ? -cmp : cmp;
    });
  }

  const total = sorted.length;
  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function textIncludes(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

// ── Lookups ─────────────────────────────────────────────────────────────────────
export const getCourse = (id: string): DemoCourse | undefined => D.courses.find((c) => c.id === id);
export const getOffering = (id: string): DemoOffering | undefined =>
  D.offerings.find((o) => o.id === id);
export const getTeacher = (id: string): DemoTeacher | undefined => D.teachers.find((t) => t.id === id);
export const getStudent = (id: string): DemoStudent | undefined => D.students.find((s) => s.id === id);
export const getSemester = (id: string) => D.semesters.find((s) => s.id === id);

/**
 * The offering's LABEL — the ONE place the demo derives it, mirroring the server's
 * `offerings/labels.offering_label`.
 *
 * `course_offerings` stores no name: the label is course code + section code, so it is
 * computed. Deriving it here rather than storing it on the row is the whole reason a screen
 * cannot show a different name than the API would — and it is why every handler returns
 * `offeringRef(...)` instead of assembling its own string.
 *
 * ORDERING NOTE: never sort on this string. "MATH1110-2" sorts before "MATH1110-10". Sort on
 * `course.code` then `section_code` — see `OFFERING_ORDER` below.
 */
export function offeringLabel(offering: DemoOffering | undefined): string {
  if (!offering) return '';
  const course = getCourse(offering.course_id);
  const code = course?.code ?? '?';
  return offering.section_code ? `${code}-${offering.section_code}` : code;
}

/** Comparator matching the server's `OFFERING_ORDER`: course code, then section code. */
export function compareOfferings(a: DemoOffering, b: DemoOffering): number {
  const ac = getCourse(a.course_id)?.code ?? '';
  const bc = getCourse(b.course_id)?.code ?? '';
  return (
    ac.localeCompare(bc) ||
    (a.section_code ?? '').localeCompare(b.section_code ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** The academic year an offering belongs to — resolved THROUGH its semester (D31). */
export function yearIdOfOffering(offeringId: string): string | undefined {
  const offering = getOffering(offeringId);
  return offering ? getSemester(offering.semester_id)?.academic_year_id : undefined;
}

export const getActiveSemester = () => D.semesters.find((s) => s.is_active);
export const getActiveYear = () => D.academic_years.find((y) => y.status === 'active');
export const getActiveGradingScale = () =>
  D.grading_scales.find((g) => g.academic_year_id === DEMO_IDS.activeYearId);

// ── Academic-year scoping (per-module year switcher) ────────────────────────────
// **D31 changed how a year is resolved.** A `classes` row carried `academic_year_id`, so the
// year was one attribute access. An offering carries `semester_id` and nothing else, so the
// year is a HOP through the semester — `offeringsForYear` below is the only place that hop
// is spelled out, exactly as `offerings/queries.offerings_in_year` is on the server.
//
// The gain is what the hop buys: an offering can now say WHICH TERM it runs in, which is
// what makes "the same course in Semester 1 and again in Semester 2" expressible at all.
export const listAcademicYears = () =>
  [...D.academic_years].sort((a, b) => b.name.localeCompare(a.name));

export function offeringsForYear(yearId: string): DemoOffering[] {
  const semIds = new Set(D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id));
  return D.offerings.filter((o) => semIds.has(o.semester_id));
}
/** The Semester 1 id for a year (where the demo anchors that year's roster/grades). */
export function primarySemesterIdForYear(yearId: string): string | undefined {
  return D.semesters.find((s) => s.academic_year_id === yearId && s.sequence === 1)?.id;
}
/**
 * The semester an offering's roster/attendance lives under.
 *
 * This is now simply the offering's OWN semester. It used to resolve "the first semester of
 * the section's year", which was a guess forced on it by a year-scoped row — and it was
 * wrong for anything that actually happened in a second term.
 */
export function semesterIdForOffering(offeringId: string): string | undefined {
  return getOffering(offeringId)?.semester_id ?? DEMO_IDS.activeSemesterId;
}
/** Students who have any enrollment in a section belonging to the given year. */
export function studentIdsForYear(yearId: string): Set<string> {
  const semIds = new Set(D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id));
  return new Set(D.enrollments.filter((e) => semIds.has(e.semester_id)).map((e) => e.student_id));
}
/** Teachers assigned to any offering in the given year. */
export function teacherIdsForYear(yearId: string): Set<string> {
  const ids = new Set<string>();
  for (const off of offeringsForYear(yearId)) off.teacher_ids.forEach((tid) => ids.add(tid));
  return ids;
}
/** The academic years a student has any enrollment in (newest first). */
export function yearsForStudent(studentId: string): DemoAcademicYear[] {
  const yearIds = new Set(
    D.enrollments
      .filter((e) => e.student_id === studentId)
      .map((e) => D.semesters.find((s) => s.id === e.semester_id)?.academic_year_id)
      .filter((id): id is string => Boolean(id)),
  );
  return D.academic_years
    .filter((y) => yearIds.has(y.id))
    .sort((a, b) => b.name.localeCompare(a.name));
}
/**
 * EVERY offering a student was enrolled in for a given year, in course-code order.
 *
 * Ended enrollments (`unenrolled_at` set) still count: for a PAST year that is the normal
 * state, so filtering them out would empty every archived-year screen.
 *
 * A year now spans BOTH semesters' offerings, which is a real change in what this answers:
 * a student who takes Algebra in Semester 1 and again in Semester 2 has TWO offerings here,
 * not one row seen twice. That is the record, and collapsing them would hide a repeat.
 */
export function offeringsForStudentInYear(studentId: string, yearId: string): DemoOffering[] {
  const semIds = new Set(D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id));
  const seen = new Map<string, DemoOffering>();
  for (const e of D.enrollments) {
    if (e.student_id !== studentId || !semIds.has(e.semester_id)) continue;
    const off = getOffering(e.offering_id);
    if (off && !seen.has(off.id)) seen.set(off.id, off);
  }
  return [...seen.values()].sort(compareOfferings);
}

/** The offerings a student is ACTIVELY enrolled in right now (the active semester). */
export function currentOfferingsFor(studentId: string): DemoOffering[] {
  const seen = new Map<string, DemoOffering>();
  for (const e of D.enrollments) {
    if (e.student_id !== studentId) continue;
    if (e.semester_id !== DEMO_IDS.activeSemesterId || e.unenrolled_at) continue;
    const off = getOffering(e.offering_id);
    if (off && !seen.has(off.id)) seen.set(off.id, off);
  }
  return [...seen.values()].sort(compareOfferings);
}

/**
 * Every offering a student sits — in `yearId` if given, else their live load.
 *
 * The one place the "which offerings, therefore which gradebooks" question is answered, so
 * the assessments tab, My Grades and the report card cannot disagree.
 *
 * **D31 removed a whole hop.** This used to resolve the student's SECTIONS and then map each
 * to its offerings through `class_subjects`; one offering per enrollment makes that a direct
 * read, and the intermediate `classSubjectsForSections` helper is gone with it.
 */
export function offeringsForStudent(studentId: string, yearId?: string | null): DemoOffering[] {
  return yearId ? offeringsForStudentInYear(studentId, yearId) : currentOfferingsFor(studentId);
}

/** The weekly meetings of one offering, in Mon→Fri / earliest-first order. */
export function meetingsForOffering(offeringId: string) {
  return D.offering_meetings
    .filter((m) => m.offering_id === offeringId)
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
}

// ── Demo session scope (the login cookie carries only a role) ────────────────────
/**
 * The demo login carries only a role, and resolveMockUser() returns a synthetic user
 * whose profile ids are NOT seeded ids. So any handler that must scope a response to
 * "the caller" maps the role → a representative SEEDED user, then derives teacher/student
 * scope from that (the same trick handlers/dashboard.ts uses). Centralized here so the
 * Classes, Assessments, and Dashboard surfaces all resolve the same person and their
 * figures reconcile across screens.
 */
export const DEMO_REPRESENTATIVE_USER_ID: Record<string, string> = {
  principal: DEMO_IDS.principalUserId,
  secretary: 'user-secretary',
  teacher: 'user-teach-1', // Maria Reyes — leads several offerings
  student: 'user-stu-1', // Freddy Lopez — active, first-year, MATH1110-01
};

/** The seeded student a demo `student` login stands in for (undefined for other roles). */
export function currentDemoStudent(role: string | null | undefined): DemoStudent | undefined {
  if (role !== 'student') return undefined;
  return D.students.find((s) => s.user_id === DEMO_REPRESENTATIVE_USER_ID.student);
}

/** The seeded teacher a demo `teacher` login stands in for (undefined for other roles). */
export function currentDemoTeacher(role: string | null | undefined): DemoTeacher | undefined {
  if (role !== 'teacher') return undefined;
  return D.teachers.find((t) => t.user_id === DEMO_REPRESENTATIVE_USER_ID.teacher);
}

// ── Students ────────────────────────────────────────────────────────────────────
export interface ListStudentsParams extends DemoListParams {
  status?: string | null;
  /** Narrow to the roster of ONE offering (D31: was `section_id`). */
  offering_id?: string | null;
  /** teacher scope: restrict to students in an offering this lecturer teaches. */
  teacher_id?: string | null;
  /** year scope: restrict to students enrolled in an offering of this academic year. */
  academic_year_id?: string | null;
  /**
   * D32 (brief §3). Attribute filters on the STUDENT RECORD, not on their enrolment — so
   * a graduated student still matches, which is what "print all Catholic students" means.
   */
  gender?: string | null;
  religion?: string | null;
  program_id?: string | null;
}
/**
 * D32 — the DISTINCT religions present on non-deleted students, sorted (brief §3).
 *
 * Backs `GET /students/filter-options`. Derived rather than hardcoded for the same reason
 * the server derives it: religion is free text on the admissions form, so a fixed list
 * would offer options that match nothing.
 */
export function studentReligions(): string[] {
  return [...new Set(D.students.map((s) => s.religion).filter((r): r is string => Boolean(r)))].sort();
}

export function listStudents(params: ListStudentsParams = {}): DemoPage<DemoStudent> {
  let rows = D.students;
  // Year scope: for a past year, restrict to students enrolled that year. For the
  // active year (or no year) keep the full directory (includes graduated/withdrawn).
  if (params.academic_year_id && params.academic_year_id !== DEMO_IDS.activeYearId) {
    const ids = studentIdsForYear(params.academic_year_id);
    rows = rows.filter((s) => ids.has(s.id));
  }
  if (params.teacher_id) {
    // A student is in scope if ANY of their offerings is one this lecturer teaches.
    const ownedIds = new Set(offeringsOwnedByTeacher(params.teacher_id).map((o) => o.id));
    rows = rows.filter((s) => currentOfferingsFor(s.id).some((o) => ownedIds.has(o.id)));
  }
  if (params.status) rows = rows.filter((s) => s.status === params.status);
  if (params.offering_id) {
    const wanted = params.offering_id;
    rows = rows.filter((s) => currentOfferingsFor(s.id).some((o) => o.id === wanted));
  }
  // The level filter reads the STUDENT's own `year_of_study`. There is nothing on an
  // offering to confuse it with any more — `grade_level` went with the homeroom.
  if (params.year_of_study) rows = rows.filter((s) => s.year_of_study === params.year_of_study);
  // D32 — all three AND with everything above, mirroring `students/service.list_students`.
  // Religion is EXACT, never a substring: the options come from the distinct stored
  // values, and a LIKE would only conflate two real ones ("Catholic" / "Roman Catholic").
  if (params.gender) rows = rows.filter((s) => s.gender === params.gender);
  if (params.religion) rows = rows.filter((s) => s.religion === params.religion);
  if (params.program_id) rows = rows.filter((s) => s.program_id === params.program_id);
  if (params.search) {
    const q = params.search;
    // Matches the backend (students/service.py): the display string AND the parts,
    // so "Perez Ana" — surname first, how a register is read — finds the student.
    rows = rows.filter(
      (s) =>
        textIncludes(s.full_name, q) ||
        textIncludes(s.first_name, q) ||
        textIncludes(s.last_name, q) ||
        textIncludes(s.student_number, q),
    );
  }

  // D30 §D10 — the register is ordered by SURNAME then given name, which `paginate`
  // cannot express (it sorts on one field). Any name-ish sort key is resolved here
  // and `paginate` is then asked for no sort at all; anything else falls through to
  // its single-column path unchanged.
  const sort = params.sort ?? 'last_name';
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  if (['last_name', 'first_name', 'name', 'full_name'].includes(key)) {
    const primary = key === 'first_name' ? 'first_name' : 'last_name';
    const secondary = key === 'first_name' ? 'last_name' : 'first_name';
    rows = [...rows].sort((a, b) => {
      const cmp =
        (a[primary] ?? '').localeCompare(b[primary] ?? '') ||
        (a[secondary] ?? '').localeCompare(b[secondary] ?? '') ||
        a.id.localeCompare(b.id);
      return desc ? -cmp : cmp;
    });
    return paginate(rows as unknown as Array<Record<string, unknown>>, {
      ...params,
      sort: undefined,
    }) as unknown as DemoPage<DemoStudent>;
  }

  return paginate(rows as unknown as Array<Record<string, unknown>>, {
    ...params,
    sort,
  }) as unknown as DemoPage<DemoStudent>;
}

// ── Teachers ────────────────────────────────────────────────────────────────────
export interface ListTeachersParams extends DemoListParams {
  status?: string | null;
  specialization?: string | null;
  /** year scope: restrict to teachers assigned to an offering in this academic year. */
  academic_year_id?: string | null;
}
export function listTeachers(params: ListTeachersParams = {}): DemoPage<DemoTeacher> {
  let rows = D.teachers;
  if (params.academic_year_id && params.academic_year_id !== DEMO_IDS.activeYearId) {
    const ids = teacherIdsForYear(params.academic_year_id);
    rows = rows.filter((t) => ids.has(t.id));
  }
  if (params.status) rows = rows.filter((t) => t.status === params.status);
  if (params.specialization) {
    rows = rows.filter((t) =>
      t.subject_specializations.some((s) => textIncludes(s, params.specialization!)),
    );
  }
  if (params.search) {
    const q = params.search;
    rows = rows.filter((t) => textIncludes(t.full_name, q) || textIncludes(t.staff_number, q));
  }
  return paginate(rows as unknown as Array<Record<string, unknown>>, {
    ...params,
    sort: params.sort ?? 'full_name',
  }) as unknown as DemoPage<DemoTeacher>;
}

// ── Courses (catalog) ───────────────────────────────────────────────────────────
export interface ListCoursesParams extends DemoListParams {
  is_active?: boolean | null;
  /** Drop the active filter and return BOTH. Mirrors the server parameter — `is_active`
   *  is an equality filter and has no value meaning "both". */
  include_retired?: boolean;
}
export function listCourses(params: ListCoursesParams = {}): DemoPage<DemoCourse> {
  let rows = D.courses;
  // Default is active-only (picker hides retired courses) unless explicitly false.
  const wantActive = params.is_active ?? true;
  if (!params.include_retired && wantActive !== null) {
    rows = rows.filter((c) => c.is_active === wantActive);
  }
  if (params.search) {
    const q = params.search;
    rows = rows.filter((c) => textIncludes(c.name, q) || textIncludes(c.code, q));
  }
  return paginate(rows as unknown as Array<Record<string, unknown>>, {
    ...params,
    sort: params.sort ?? 'name',
  }) as unknown as DemoPage<DemoCourse>;
}

// ── Offerings / ownership ───────────────────────────────────────────────────────
export function offeringsOwnedByTeacher(teacherId: string): DemoOffering[] {
  return D.offerings.filter((o) => o.teacher_ids.includes(teacherId));
}

/**
 * Roster (unenrolled_at IS NULL) of an offering, in the offering's OWN semester.
 *
 * The semester comes off the offering, so this is correct for the active year, an archived
 * year, AND a second term of the current year — the case the previous version could not
 * express, because it inferred "Semester 1 of the section's year".
 */
export function rosterFor(offeringId: string): DemoStudent[] {
  const semId = semesterIdForOffering(offeringId);
  const ids = D.enrollments
    .filter((e) => e.offering_id === offeringId && e.semester_id === semId && !e.unenrolled_at)
    .map((e) => e.student_id);
  return D.students.filter((s) => ids.includes(s.id));
}
export function activeEnrollmentFor(
  studentId: string,
  offeringId: string,
): DemoEnrollment | undefined {
  const semId = semesterIdForOffering(offeringId);
  return D.enrollments.find(
    (e) =>
      e.student_id === studentId &&
      e.offering_id === offeringId &&
      e.semester_id === semId &&
      !e.unenrolled_at,
  );
}
export function enrolledCount(offeringId: string): number {
  return rosterFor(offeringId).length;
}

// ── Assessments / grades ────────────────────────────────────────────────────────
export function assessmentsForOffering(offeringId: string): DemoAssessment[] {
  return D.assessments.filter((a) => a.offering_id === offeringId);
}
export function gradesForAssessment(assessmentId: string): DemoAssessmentGrade[] {
  return D.assessment_grades.filter((g) => g.assessment_id === assessmentId);
}

/**
 * The gradebook read for an offering: roster (active enrollment) ∪ any student who has a
 * grade row for it (M3 — a student who switched sections stays visible).
 * Returns rows of { student, enrollment_id, is_active_member, cells[] }.
 */
/**
 * D32 mid-term revision eligibility, mirroring
 * `backend/app/modules/grades/revisions.py::midterm_revision_eligible` (brief §1).
 *
 * Demo mode has to carry this rule too. The last two times a grading rule lived in only
 * one of the two implementations, demo mode certified a screen the real backend refused.
 *
 * **ONE DELIBERATE DIVERGENCE.** The server reads `assessments.created_at` and
 * `assessment_grades.graded_at`; the demo dataset has neither — it is a hand-authored
 * fixture with no audit stamps. `assessment_date` stands in for both. That is the right
 * proxy here: it is when the work happened, so an assessment dated before the window
 * opened is exactly the "was part of the mid-term submission" case the rule is about, and
 * it makes the two states visible in the marquee gradebook. It is NOT the rule the server
 * applies, and the seed comment on `SEM_ACTIVE` says so.
 */
export function midtermRevisionEligible(
  a: DemoAssessment,
  g: DemoAssessmentGrade | undefined,
): { eligible: boolean; reason: string | null } {
  const sem = getSemester(a.semester_id);
  if (!sem) return { eligible: false, reason: 'not_current_semester' };

  const start = sem.midterm_submission_start;
  const end = sem.midterm_submission_end;
  if (!start || !end) return { eligible: false, reason: 'no_midterm_window' };

  // DEMO_TODAY, not the real clock — same reason as `gradeWindow()` in the handler: the
  // dataset is deterministic, and reading `Date.now()` would make the answer depend on
  // when the demo happens to be opened.
  const now = new Date(DEMO_TODAY_ISO).getTime();
  if (now <= new Date(end).getTime()) {
    return { eligible: false, reason: 'midterm_window_open' };
  }

  const openedAt = new Date(start).getTime();
  const worked = a.assessment_date ? new Date(a.assessment_date).getTime() : null;
  if (worked === null || worked >= openedAt) {
    return { eligible: false, reason: 'assessment_after_window' };
  }
  if (!g) return { eligible: false, reason: 'not_graded' };
  if (g.status !== 'graded' || g.score == null) {
    return { eligible: false, reason: 'not_graded' };
  }
  if (!sem.is_active) return { eligible: false, reason: 'not_current_semester' };

  return { eligible: true, reason: null };
}

export function gradebookFor(offeringId: string): {
  offering: DemoOffering | undefined;
  assessments: DemoAssessment[];
  rows: Array<{
    student: DemoStudent;
    enrollment_id: string | null;
    is_active_member: boolean;
    cells: Array<{
      assessment_id: string;
      status: DemoAssessmentGrade['status'];
      score: number | null;
      makeup_score: number | null;
      is_released: boolean;
      letter?: string;
      can_request_revision: boolean;
      revision_blocked_reason: string | null;
    }>;
    term_numeric: number | null;
    term_letter: string | null;
  }>;
} {
  const offering = getOffering(offeringId);
  const asmts = assessmentsForOffering(offeringId);
  const asmtIds = new Set(asmts.map((a) => a.id));

  const activeStudents = offering ? rosterFor(offering.id) : [];
  const gradedStudentIds = new Set(
    D.assessment_grades.filter((g) => asmtIds.has(g.assessment_id)).map((g) => g.student_id),
  );
  const activeIds = new Set(activeStudents.map((s) => s.id));
  const extraStudents = D.students.filter((s) => gradedStudentIds.has(s.id) && !activeIds.has(s.id));
  const allStudents = [...activeStudents, ...extraStudents];

  const rows = allStudents.map((student) => {
    const isActive = activeIds.has(student.id);
    const enr = offering ? activeEnrollmentFor(student.id, offering.id) : undefined;
    const cells = asmts.map((a) => {
      const g = D.assessment_grades.find(
        (row) => row.assessment_id === a.id && row.student_id === student.id,
      );
      const released = g?.is_released ?? a.is_released;
      const revision = midtermRevisionEligible(a, g);
      return {
        assessment_id: a.id,
        status: g?.status ?? ('pending' as DemoAssessmentGrade['status']),
        score: g?.score ?? null,
        makeup_score: g?.makeup_score ?? null,
        is_released: released,
        ...(g?.status === 'graded' && g.score != null
          ? { letter: letterFor((g.score / a.max_score) * 100) }
          : {}),
        // D32. The handler zeroes this for non-Lecturer viewers — the selector has no
        // caller identity, and the server's rule is "may YOU file one".
        can_request_revision: revision.eligible,
        revision_blocked_reason: revision.reason,
      };
    });
    const term = computeTermGrade(student.id, offeringId);
    return {
      student,
      enrollment_id: enr?.id ?? null,
      is_active_member: isActive,
      cells,
      term_numeric: term.numeric,
      term_letter: term.letter,
    };
  });

  return { offering, assessments: asmts, rows };
}

/**
 * Weighted term grade for (student, offering) + derived letter. Weighted by each
 * assessment's `weight`; only `graded` rows count (pending/excused/exempt excluded,
 * api-spec §8.3). Returns { numeric, letter }.
 *
 * There is no separate "in the active semester" qualifier any more: an offering IS a term,
 * so the assessments it holds are that term's by construction.
 */
export function computeTermGrade(
  studentId: string,
  offeringId: string,
): { numeric: number | null; letter: string | null; weight_base_used: number } {
  const asmts = assessmentsForOffering(offeringId).filter((a) => a.status === 'graded');
  let weightedSum = 0;
  let weightBase = 0;
  for (const a of asmts) {
    const g = D.assessment_grades.find(
      (row) => row.assessment_id === a.id && row.student_id === studentId,
    );
    if (!g) continue;
    let effectiveScore: number | null = null;
    if (g.status === 'graded' && g.score != null) effectiveScore = g.score;
    else if (g.status === 'absent') {
      if (g.makeup_score != null) effectiveScore = g.makeup_score;
      else if (D.assessment_policy.absent_as_zero) effectiveScore = 0;
      else continue; // absent, not counted
    } else {
      continue; // pending / excused / exempt — excluded
    }
    const pct = (effectiveScore / a.max_score) * 100;
    weightedSum += pct * a.weight;
    weightBase += a.weight;
  }
  if (weightBase === 0) return { numeric: null, letter: null, weight_base_used: 0 };
  const numeric = Math.round((weightedSum / weightBase) * 100) / 100;
  return { numeric, letter: letterFor(numeric), weight_base_used: weightBase };
}

/**
 * Derive the letter grade for a 0..100 numeric against the active bands (D11).
 *
 * **HALF-OPEN on `min_score`** — the highest band whose floor the value clears, with
 * `max_score` never consulted. This mirrors `calc.letter_for` (OQ-DB2), and D30 made it
 * mandatory rather than merely tidy: the BAJC scale's ceilings are the integers the
 * college prints (A- is 90-94), so the old `min <= v && v <= max` test left every
 * fractional value between bands — a 94.5, an 89.7 — matching NO band and rendering
 * blank where a letter belongs.
 */
export function letterFor(numeric: number): string {
  const scale = getActiveGradingScale();
  if (!scale) return '';
  const clamped = Math.min(Math.max(numeric, 0), 100);
  const ordered = [...scale.bands].sort((a, b) => b.min_score - a.min_score);
  const band = ordered.find((b) => clamped >= b.min_score);
  // Below every floor is only reachable if the lowest band starts above 0.
  return (band ?? ordered[ordered.length - 1])?.letter ?? '';
}

/** The 4.00-scale value of a letter, or null if the scale cannot price it (D30 §D5). */
export function gradePointFor(letter: string | null): number | null {
  if (!letter) return null;
  const scale = getActiveGradingScale();
  const wanted = letter.trim().toLowerCase();
  const band = scale?.bands.find((b) => b.letter.trim().toLowerCase() === wanted);
  return band?.grade_point ?? null;
}

/**
 * Credit-weighted GPA, mirroring `calc.compute_gpa` (D30 §D5, decision #4).
 *
 * The denominator is ALL enrolled credits: an entry with no letter contributes 0 quality
 * points and keeps its credits. Restricting it to graded courses is the divergence that
 * would make demo mode print 3.50 where the real backend prints 2.10 — and this project
 * has already paid twice for demo mode certifying a screen the server answered
 * differently.
 *
 * `null` when no credits participated; the documents render that as an em dash rather
 * than a 0.00 that would read as total failure.
 */
export function gpaFor(
  entries: { credits: number | null; letter: string | null }[],
): { gpa: number | null; total_credits: number } {
  let credits = 0;
  let quality = 0;
  for (const entry of entries) {
    const weight = entry.credits ?? 0;
    if (weight <= 0) continue;
    credits += weight;
    quality += (gradePointFor(entry.letter) ?? 0) * weight;
  }
  if (credits <= 0) return { gpa: null, total_credits: 0 };
  return { gpa: Math.round((quality / credits) * 100) / 100, total_credits: credits };
}

// ── Prerequisites (D30 §D4) ─────────────────────────────────────────────────────
/**
 * Every course this student has PASSED, outside `excludeSemesterId`.
 *
 * Mirrors `grades/service.completed_course_results` closely enough for the gate to
 * agree with the server: a result counts only if the student sat the course in some
 * OTHER term and passed it. Excluding the target term is what stops a course from
 * satisfying its own prerequisite — enrolling into MATH1 and MATH2 together must not
 * wave MATH2 through.
 *
 * Simpler than the server in one way, deliberately: demo mode has no frozen snapshots
 * and one grading scale, so there is nothing to reconcile across years.
 */
export function passedCourseIds(studentId: string, excludeSemesterId: string): Set<string> {
  const scale = getActiveGradingScale();
  const passed = new Set<string>();
  for (const enr of D.enrollments) {
    if (enr.student_id !== studentId) continue;
    if (enr.semester_id === excludeSemesterId) continue;
    const offering = getOffering(enr.offering_id);
    if (!offering) continue;
    const { numeric, letter } = computeTermGrade(studentId, offering.id);
    if (numeric === null || !letter) continue;
    const band = scale?.bands.find((b) => b.letter === letter);
    if (band?.is_passing) passed.add(offering.course_id);
  }
  return passed;
}

/**
 * The unmet requirements standing between this student and this course. `[]` = clear.
 *
 * `all_program_courses` expands to every REQUIRED course in the programme (electives
 * a student legitimately did not choose are not missing requirements), and applies
 * only to students on that programme.
 *
 * Every demo student now carries a programme (D30 §D12), so the programme-scoped rules —
 * including the `ALL COURSES` Internship gate — do fire here rather than being theoretical.
 */
export function unmetPrerequisites(
  studentId: string,
  courseId: string,
  semesterId: string,
): Array<{ code: string; reason: string }> {
  const rules = D.course_prerequisites.filter((p) => p.course_id === courseId);
  if (rules.length === 0) return [];

  const student = D.students.find((s) => s.id === studentId);
  const studentProgramId = (student as { program_id?: string | null } | undefined)?.program_id ?? null;
  const applicable = rules.filter((r) => r.program_id === null || r.program_id === studentProgramId);
  if (applicable.length === 0) return [];

  const passed = passedCourseIds(studentId, semesterId);
  const issues: Array<{ code: string; reason: string }> = [];

  const record = (requiredId: string) => {
    if (passed.has(requiredId)) return;
    const course = getCourse(requiredId);
    issues.push({
      code: course?.code ?? '?',
      reason: 'not passed',
    });
  };

  for (const rule of applicable) {
    if (rule.requirement_type === 'all_program_courses') {
      D.program_courses
        .filter(
          (pc) =>
            pc.program_id === rule.program_id &&
            pc.course_id !== courseId &&
            pc.is_required,
        )
        .forEach((pc) => record(pc.course_id));
    } else if (rule.prerequisite_course_id) {
      record(rule.prerequisite_course_id);
    }
  }
  return issues;
}

// ── Attendance ──────────────────────────────────────────────────────────────────
/** All attendance records for an offering on a given date. */
export function attendanceFor(offeringId: string, date: string) {
  return D.attendance_records.filter(
    (a) => a.offering_id === offeringId && a.attendance_date === date,
  );
}
/** Attendance summary (present/absent/late/excused + pct_present) for an offering. */
export function attendanceSummaryForOffering(offeringId: string): {
  present: number;
  absent: number;
  late: number;
  excused: number;
  pct_present: number;
} {
  const rows = D.attendance_records.filter((a) => a.offering_id === offeringId);
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of rows) counts[r.status] += 1;
  const total = rows.length || 1;
  return { ...counts, pct_present: Math.round((counts.present / total) * 1000) / 10 };
}
/**
 * One student's OWN attendance rate (%) across every class they sit.
 *
 * Attendance is per offering, so a student has records in several. This averages over all
 * of them — "my attendance" is the whole week, not one course's register. Late counts as
 * present, matching `schoolAttendanceRate`.
 */
export function attendanceRateForStudent(studentId: string): number {
  const rows = D.attendance_records.filter((r) => r.student_id === studentId);
  if (rows.length === 0) return 0;
  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
  return Math.round((present / rows.length) * 1000) / 10;
}

/** School-wide attendance rate (%) over the recent window — Principal dashboard. */
export function schoolAttendanceRate(): number {
  const activeOfferingIds = new Set(offeringsForYear(DEMO_IDS.activeYearId).map((o) => o.id));
  const rows = D.attendance_records.filter((r) => activeOfferingIds.has(r.offering_id));
  if (rows.length === 0) return 0;
  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
  return Math.round((present / rows.length) * 1000) / 10;
}

// ── Announcements ───────────────────────────────────────────────────────────────
/**
 * Announcements targeted at a given user, live (published, unexpired), newest first.
 *
 * Mirrors the backend's `_audience_clause` + `_visible_clause`
 * (`app/modules/announcements/service.py`). Kept deliberately close to it: this handler
 * is the binding contract the frontend is developed against, so anywhere the two
 * diverge is a bug the demo cannot show. Two such divergences were fixed here:
 *
 *  1. **No admin branch.** Principal and secretary fell through to "school-wide only",
 *     so in demo they could not see the `students` / `teachers` / `class` notices they
 *     themselves post — while the real backend shows admins everything admin-authored
 *     (`_authored_by_admin()`). The audience filter on the feed was therefore untestable
 *     for the two roles that have all four options.
 *  2. **`published_at` was ignored**, so future-dated (scheduled) notices leaked into
 *     the feed. The backend gates on `published_at <= now`.
 *
 * Authorship is also honoured now (`author_user_id === userId`), matching the backend's
 * "an author always sees their own, whatever the audience" rule. Previously only the
 * by-id handler patched that in.
 */
export function announcementsForUser(userId: string) {
  const user = D.users.find((u) => u.id === userId);
  if (!user) return [];
  const now = new Date(`${DEMO_TODAY}T23:59:59Z`).getTime();
  const isAdmin = user.role === 'principal' || user.role === 'secretary';
  const adminUserIds = new Set(
    D.users.filter((u) => u.role === 'principal' || u.role === 'secretary').map((u) => u.id),
  );
  // Which offerings is this user linked to (student via enrollment, lecturer via teaching)?
  const linkedOfferingIds = new Set<string>();
  if (user.role === 'student') {
    // An offering-targeted announcement reaches the student if it targets ANY of theirs.
    const stu = D.students.find((s) => s.user_id === userId);
    if (stu) for (const off of currentOfferingsFor(stu.id)) linkedOfferingIds.add(off.id);
  } else if (user.role === 'teacher') {
    const teacher = D.teachers.find((tt) => tt.user_id === userId);
    if (teacher) for (const off of offeringsOwnedByTeacher(teacher.id)) linkedOfferingIds.add(off.id);
  }
  return D.announcements
    .filter((a) => {
      // ── visibility window ──
      if (a.expires_at && new Date(a.expires_at).getTime() <= now) return false;
      if (new Date(a.published_at).getTime() > now) return false;
      // ── targeting ──
      if (a.author_user_id === userId) return true; // author always sees their own
      if (a.audience === 'all') return true;
      if (isAdmin) {
        // P/S see every notice an administrator broadcast, whatever its audience —
        // including their own `students`/`teachers` broadcasts. They do NOT get a
        // blanket override on teacher-authored class notices (backend has none either).
        return adminUserIds.has(a.author_user_id);
      }
      if (a.audience === 'students') return user.role === 'student';
      if (a.audience === 'teachers') return user.role === 'teacher';
      // The `'class'` audience VALUE is unchanged (it is a shared wire enum member); the
      // target it names is an offering.
      if (a.audience === 'class')
        return a.offering_id ? linkedOfferingIds.has(a.offering_id) : false;
      return false;
    })
    .sort((x, y) => y.published_at.localeCompare(x.published_at));
}
export function unreadCountForUser(userId: string): number {
  return announcementsForUser(userId).filter((a) => !a.read_by_user_ids.includes(userId)).length;
}

// ── Dashboard (role-scoped composite) ───────────────────────────────────────────
/**
 * A role-shaped dashboard payload for the demo. Numbers are computed live from the
 * dataset so they reconcile with the list/detail screens (e.g. total_students ==
 * listStudents({}).total). Module 7.9 (Dashboard) can shape this into the exact
 * `DashboardResponse` union — this returns the raw reconciled figures.
 */
export function dashboardFor(role: string, userId?: string) {
  const semester = getActiveSemester();
  if (role === 'principal' || role === 'secretary') {
    return {
      role,
      semester,
      stats: {
        total_students: D.students.filter((s) => s.status === 'Registered').length,
        total_teachers: D.teachers.filter((t) => t.status === 'active').length,
        total_classes: offeringsForYear(DEMO_IDS.activeYearId).length,
        attendance_rate: schoolAttendanceRate(),
      },
      enrollment_by_year_of_study: enrollmentByYearOfStudy(),
      grade_distribution: gradeDistribution(),
    };
  }
  if (role === 'teacher') {
    const teacher = userId ? D.teachers.find((tt) => tt.user_id === userId) : undefined;
    const owned = teacher
      ? offeringsOwnedByTeacher(teacher.id).filter((o) => !o.is_archived)
      : [];
    return {
      role,
      semester,
      stats: {
        // ONE number, not two. It used to report `my_classes` (distinct sections) AND
        // `my_class_subjects` (offerings) — which were the same count the moment a class
        // taught one subject, so the dashboard showed the same figure twice under two names.
        my_offerings: owned.length,
        ungraded_items: owned.reduce(
          (n, off) =>
            n +
            assessmentsForOffering(off.id).filter(
              (a) => a.status === 'published' || a.status === 'grading',
            ).length,
          0,
        ),
      },
    };
  }
  // student
  const stu = userId ? D.students.find((s) => s.user_id === userId) : undefined;
  return {
    role,
    semester,
    stats: {
      term_average: null as number | null,
      // Averaged across every offering the student sits, since attendance is taken per
      // offering — a single course's rate would not be "my attendance".
      attendance_rate: stu ? attendanceRateForStudent(stu.id) : 0,
    },
  };
}

/**
 * Active students per YEAR OF STUDY.
 *
 * Counts the student's own `year_of_study`. Bucketing by offering would count one student
 * once per course they take, and there is no level on an offering to bucket by anyway.
 */
export function enrollmentByYearOfStudy(): Array<{ year_of_study: string; count: number }> {
  const map = new Map<string, number>();
  for (const s of D.students) {
    if (s.status !== 'Registered' || !s.year_of_study) continue;
    map.set(s.year_of_study, (map.get(s.year_of_study) ?? 0) + 1);
  }
  // 'First' before 'Second' — progression order, which alphabetical happens to give.
  return [...map.entries()]
    .map(([year_of_study, count]) => ({ year_of_study, count }))
    .sort((a, b) => a.year_of_study.localeCompare(b.year_of_study));
}

// ── Calendar events ──────────────────────────────────────────────────────────────
export const getEvent = (id: string): DemoEvent | undefined => D.events.find((e) => e.id === id);

/**
 * School-wide events, optionally clipped to a `[from, to]` inclusive date window
 * (YYYY-MM-DD). An event matches the window if its own span overlaps it. Sorted by
 * start date then start time, so callers get a stable, chronological feed.
 */
export function listEvents(from?: string | null, to?: string | null): DemoEvent[] {
  return D.events
    .filter((e) => {
      const eStart = e.start_date;
      const eEnd = e.end_date ?? e.start_date;
      if (from && eEnd < from) return false;
      if (to && eStart > to) return false;
      return true;
    })
    .slice()
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        (a.start_time ?? '').localeCompare(b.start_time ?? '') ||
        a.id.localeCompare(b.id),
    );
}

export function gradeDistribution(): Array<{ letter: string; count: number }> {
  const scale = getActiveGradingScale();
  const counts = new Map<string, number>();
  if (scale) for (const b of scale.bands) counts.set(b.letter, 0);
  for (const off of offeringsForYear(DEMO_IDS.activeYearId)) {
    for (const stu of rosterFor(off.id)) {
      const { letter } = computeTermGrade(stu.id, off.id);
      if (letter) counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([letter, count]) => ({ letter, count }));
}
