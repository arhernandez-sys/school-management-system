/**
 * Grades module wire types (api-spec §5.7). These mirror the shapes the demo MSW
 * grades handler returns; the screens are typed strictly against them. Letter grades
 * are plain strings (derived-on-read from the configurable scale, D11 — never an enum).
 *
 * **D31 deleted this file's private offering refs.** It used to define `SectionRef`
 * (a "fat" homeroom ref with `grade_level` and a division letter), `SubjectRef`, and
 * `ClassSubjectRef` keyed `id` and carrying `display_name`. Assessments keyed the same
 * concept `offering_id`, Attendance had a third variant, and the old comment said none
 * were interchangeable. That was true, and it was the problem: an offering's label is
 * DERIVED server-side now, so three private client derivations of one string would drift
 * and the screens are where the drift shows. All of them now carry the shared
 * `OfferingRef` from `@shared/types/api`; what stays local here is only the staffing the
 * picker actually needs.
 *
 * ⚠️ `GradebookCell`, `MyGradeAssessment` and `GradeCellResult` are the three models whose
 * `components.schemas` entry in `openapi.json` is an empty `{"type": "object"}` — their
 * Pydantic base uses a wrap `@model_serializer` (to drop `letter` when unset), which erases
 * the generated JSON schema. So for these three the spec is NOT the contract; the backend
 * schema classes are. Typed by hand against `grades/schemas.py` accordingly.
 */
import type { CourseRef, OfferingRef } from '@shared/types/api';
import type { GradeStatus } from '@shared/types/enums';

export type { CourseRef, OfferingRef };

/**
 * Grades' own teacher ref — `{ id, full_name }`, WITHOUT `staff_number`.
 *
 * Deliberately not the shared `TeacherRef`: a gradebook names its lecturers, it does not
 * administer them, and the staff number is directory data nothing on these screens shows.
 * This is the "genuinely module-local" half the D31 consolidation kept local.
 */
export interface GradeTeacherRef {
  id: string;
  full_name: string;
}

/**
 * An offering as the Grades module sees it: the shared ref plus who teaches it.
 *
 * The staffing is what makes the gradebook picker usable ("Algebra — Mr. Smith") and what
 * `can_edit` is judged against, so it rides along rather than costing a second request.
 */
export interface GradesOfferingRef {
  offering: OfferingRef;
  teachers: GradeTeacherRef[];
  lead_teacher_id: string | null;
}

/** An offering option in the gradebook picker (`GET /grades/offerings`). */
export interface OfferingOption extends GradesOfferingRef {
  assessment_count: number;
  /** Whether the CURRENT caller may enter grades in this offering. */
  can_edit: boolean;
}

export interface OfferingOptionsResponse {
  items: OfferingOption[];
}

export interface StudentRef {
  id: string;
  full_name: string;
  student_number: string;
}

/** One assessment column header in the gradebook. */
export interface GradebookAssessment {
  id: string;
  title: string;
  category_id: string | null;
  max_score: number;
  weight: number;
  assessment_date: string | null;
  graded_count: number;
  entered_count: number;
  /**
   * D47 — the 5-day MARKING WINDOW (`backend/app/modules/assessments/marking.py`). Entry is
   * accepted while `marking_open`; after that the server answers 409 `marking_closed` and a
   * blank mark counts as 0. There is no publish or release step any more.
   */
  marking_open: boolean;
  /** When the ORIGINAL window ended (23:59 Belize, 5 days after the assessment date). */
  marking_closes_at: string | null;
  /** Set once the Dean has approved a reopen request. */
  reopened_until: string | null;
  /** When entry actually locks — the later of the two above. */
  effective_closes_at: string | null;
  /** Whole school days left (0 = closes today); null once closed. */
  days_left: number | null;
  /** The owning lecturer may ask the Dean to reopen it (closed, nothing pending). */
  can_request_reopen: boolean;
  pending_reopen_request_id: string | null;
}

export interface GradebookCategory {
  id: string;
  name: string;
  weight: number;
  drop_lowest_count: number;
}

/** One cell = a student's grade row for one assessment. */
/**
 * Why a result cannot be revised (D32, brief §1). Mirrors `REVISION_BLOCKED_REASONS` in
 * `backend/app/modules/grades/revisions.py` — the copy there carries the full prose; this
 * side only needs the discriminator plus the short tooltip in `REVISION_BLOCKED_COPY`.
 */
export type RevisionBlockedReason =
  | 'no_midterm_window'
  | 'midterm_window_open'
  | 'assessment_after_window'
  | 'grade_after_window'
  | 'not_current_semester'
  | 'not_graded';

export interface GradebookCell {
  assessment_id: string;
  status: GradeStatus;
  score: number | null;
  makeup_score: number | null;
  /**
   * D47 — no mark was entered and the marking window has closed, so this counts as 0 in
   * the term grade. `score` stays null: nothing was written.
   */
  auto_zero: boolean;
  letter?: string;
  /**
   * D32 — may the viewing Lecturer file a Revision of Grades against this result?
   *
   * SERVER-COMPUTED, deliberately. The four rules read `assessments.created_at`,
   * `assessment_grades.graded_at` and the term's mid-term window, none of which this
   * payload carries; re-deriving them here would be a second implementation of the rule
   * that could disagree with the endpoint. Always false for a non-Lecturer viewer.
   */
  can_request_revision: boolean;
  /** The reason code when `can_request_revision` is false; null when it is true. */
  revision_blocked_reason: RevisionBlockedReason | null;
}

export interface GradebookRow {
  student: StudentRef;
  enrollment_id: string | null;
  /** false = transferred/withdrawn; row retained for history, read-only. */
  is_active_member: boolean;
  cells: GradebookCell[];
  term_numeric: number | null;
  term_letter: string | null;
}

export interface Gradebook {
  offering: GradesOfferingRef | null;
  /**
   * The term the gradebook is scoped to. NOT the shared `SemesterRef`: grades serves
   * `{ id, name, sequence }` with no `is_active` — a gradebook is read for archived terms
   * as readily as live ones, so "is this the current term" is not a fact about it.
   */
  semester: { id: string; name: string; sequence: number } | null;
  assessments: GradebookAssessment[];
  categories: GradebookCategory[];
  rows: GradebookRow[];
  drop_lowest_applied: boolean;
  /** Whether the current viewer may write (lecturer owns it). */
  can_edit: boolean;
  /**
   * D30 §D6, **retired by D42 §5**. Always `false` / `null` — the end-of-session grade
   * submission deadline is neither configurable nor enforced. Kept on the type because
   * the server still sends both keys; nothing in the app reads them.
   */
  grade_window_closed: boolean;
  grade_submission_deadline: string | null;
  /**
   * D33 (client ask 7) — true while the term's mid-session grading period is RUNNING,
   * during which nobody enters a grade for this term. The only closing window left.
   *
   * Kept SEPARATE from `can_edit`, which means "your role and ownership permit writing
   * here": a running freeze and a Registrar's read-only view are different situations and
   * the Lecturer needs to know which one they are looking at. The dates travel with it so
   * the UI can name the reopen date rather than saying "later".
   */
  midterm_frozen: boolean;
  midterm_submission_start: string | null;
  midterm_submission_end: string | null;
  viewer_role: string;
}

/** PUT /assessments/{id}/grades request body. */
export interface GradeEntry {
  student_id: string;
  status: GradeStatus;
  score?: number | null;
  makeup_score?: number | null;
}

export interface GradeCellResult {
  student_id: string;
  status: GradeStatus;
  score: number | null;
  makeup_score: number | null;
  letter?: string;
}

export interface GradeEntryResponse {
  updated: GradeCellResult[];
}

// ── Student "My Grades" ───────────────────────────────────────────────────────────
export interface MyGradeAssessment {
  assessment_id: string;
  title: string;
  max_score: number;
  assessment_date: string | null;
  status: GradeStatus;
  score: number | null;
  /** D47 — see `GradebookCell.auto_zero`. */
  auto_zero: boolean;
  letter?: string;
}

/**
 * One card on "My Grades" — the wire key stays `by_subject`, so this stays
 * `MyGradeSubject`. To a student their offerings simply ARE their courses, and the
 * grouping is per offering.
 */
export interface MyGradeSubject {
  offering: GradesOfferingRef | null;
  teacher: GradeTeacherRef | null;
  assessments: MyGradeAssessment[];
  term_numeric: number | null;
  term_letter: string | null;
}

export interface MyGrades {
  student: StudentRef;
  by_subject: MyGradeSubject[];
}

// ── D47 — the printable assessment report (`GET /grades/assessment-report`) ─────────
export interface AssessmentReportColumn {
  id: string;
  title: string;
  category_name: string | null;
  assessment_date: string | null;
  max_score: number;
  marking_open: boolean;
  effective_closes_at: string | null;
}

export interface AssessmentReportRow {
  student: StudentRef;
  /** The gradebook's own cells, in column order. */
  cells: GradebookCell[];
  term_numeric: number | null;
  term_letter: string | null;
}

export interface AssessmentReportOffering {
  offering: GradesOfferingRef | null;
  semester: { id: string; name: string; sequence: number } | null;
  assessments: AssessmentReportColumn[];
  rows: AssessmentReportRow[];
}

export interface AssessmentReport {
  generated_at: string;
  /** Offerings that matched; `offerings` holds at most the first 60. */
  total_offerings: number;
  truncated: boolean;
  offerings: AssessmentReportOffering[];
}

export interface AssessmentReportParams {
  academic_year_id?: string;
  semester_id?: string;
  offering_id?: string;
  student_id?: string;
  teacher_id?: string;
}

// ── D47 — reopen requests (`/assessment-reopen-requests`) ───────────────────────────
export type ReopenRequestStatus = 'pending' | 'approved' | 'denied';

export interface ReopenRequest {
  id: string;
  assessment_id: string;
  assessment_title: string;
  assessment_date: string | null;
  max_score: number | null;
  offering: OfferingRef | null;
  status: ReopenRequestStatus;
  reason: string;
  granted_days: number | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  marking_closes_at: string | null;
  reopened_until: string | null;
  /** Roster members with no mark — what will count as 0 if this is denied. */
  blank_count: number;
  requested_by_user_id: string;
  requested_by_name: string;
  decided_by_user_id: string | null;
  decided_by_name: string | null;
  can_withdraw: boolean;
}

export interface ReopenRequestList {
  items: ReopenRequest[];
  /** Awaiting the caller's decision — non-zero only for the Dean. */
  pending_for_me: number;
}

export interface ReopenDecisionPayload {
  status: 'approved' | 'denied';
  granted_days?: number;
  decision_note?: string | null;
}
