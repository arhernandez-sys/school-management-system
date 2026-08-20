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
import type { AssessmentType, GradeStatus } from '@shared/types/enums';

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
  type: AssessmentType;
  category_id: string | null;
  max_score: number;
  weight: number;
  assessment_date: string | null;
  status: 'draft' | 'published' | 'grading' | 'graded';
  is_released: boolean;
  /** Non-draft assessments accept grade entry. */
  is_editable: boolean;
  graded_count: number;
  entered_count: number;
}

export interface GradebookCategory {
  id: string;
  name: string;
  weight: number;
  drop_lowest_count: number;
}

/** One cell = a student's grade row for one assessment. */
export interface GradebookCell {
  assessment_id: string;
  status: GradeStatus;
  score: number | null;
  makeup_score: number | null;
  is_released: boolean;
  letter?: string;
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
   * True once the term's `grade_submission_deadline` has passed (D30 §D6). Kept
   * SEPARATE from `can_edit`, which still means "your role and ownership permit
   * writing here" — a shut deadline and a Registrar's read-only view are different
   * situations and the Lecturer needs to know which one they are looking at.
   */
  grade_window_closed: boolean;
  grade_submission_deadline: string | null;
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
  type: AssessmentType;
  max_score: number;
  assessment_date: string | null;
  status: GradeStatus;
  score: number | null;
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
