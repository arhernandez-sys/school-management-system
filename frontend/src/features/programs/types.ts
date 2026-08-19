/**
 * Programmes / studies wire types (D30 §D3).
 *
 * Hand-written rather than generated: the programmes endpoints are not in the served
 * `openapi.json` (it covers 4 of 14 modules) and `npm run generate:api` must not be
 * run. Same arrangement as the Students feature.
 */
import type { CourseComponent } from '@shared/api/generated/model';

/** The catalog course a curriculum row points at. */
export interface ProgramCourseRef {
  id: string;
  code: string;
  name: string;
  credits: number;
  component: CourseComponent | null;
  is_active: boolean;
}

/** One course placed in a programme's plan. */
export interface ProgramCourseItem {
  /** The `program_courses` row id — what PATCH/DELETE address, NOT the course id. */
  id: string;
  course: ProgramCourseRef;
  is_required: boolean;
}

/**
 * One curriculum position and everything the plan puts in it.
 *
 * ⚠️ NOT a calendar term. "Semester 1" here means "the first semester of this
 * programme's plan", not any dated row in `semesters` (§D3). `term_order` is what
 * makes "Spring 1" sit between "Semester 2" and "Semester 3" for Primary Education
 * without the label having to be parseable — the label sorts alphabetically before
 * "Summer 1", so it can never be the ordering key.
 */
export interface TermBlock {
  term_label: string;
  term_order: number;
  /** Sum of `credits` across this block's courses, computed server-side. */
  credits: number;
  courses: ProgramCourseItem[];
}

/** Row in GET /programs. */
export interface ProgramListItem {
  id: string;
  code: string;
  name: string;
  award: string | null;
  /** Total credits as PRINTED on the programme's course sequence (86–102). */
  total_credits: number | null;
  /**
   * The programme's pass mark as a grade point — 2.50 (C+) everywhere except Primary
   * Education, which is 2.00 (C). Serialised as a string by the API (Decimal).
   */
  min_passing_grade_point: string;
  is_active: boolean;
  course_count: number;
  /** Sum of credits across the curriculum. Compared against `total_credits` so a
   *  half-entered sequence is visible rather than quietly wrong. */
  curriculum_credits: number;
}

/** GET /programs/{id}, and the response of every curriculum write. */
export interface ProgramDetail extends ProgramListItem {
  curriculum: TermBlock[];
}

export interface ProgramWritePayload {
  code: string;
  name: string;
  award?: string | null;
  total_credits?: number | null;
  min_passing_grade_point?: string;
  is_active?: boolean;
}

export interface ProgramCourseWritePayload {
  course_id: string;
  term_label: string;
  term_order: number;
  is_required?: boolean;
}

export interface ProgramCourseUpdatePayload {
  term_label?: string;
  term_order?: number;
  is_required?: boolean;
}

export interface ProgramsListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  search?: string;
  is_active?: boolean;
}
