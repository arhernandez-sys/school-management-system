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
  /**
   * D44, from the client's `sims_10` dump. Prose, not rules — `program_courses` and
   * `course_prerequisites` already express what the system can ENFORCE, and these are the
   * prospectus text around them.
   */
  admission_requirements: string | null;
  graduation_requirements: string | null;
  /** D44. Registrar's free-text notes on the programme. */
  comments: string | null;
  /**
   * D45 §8 — Department Management. BAJC has no departments table and a PROGRAMME is the
   * unit it organises by, so the blueprint's two departmental fields live here.
   *
   * `head_of_department` is a DISPLAYED name only. The authoritative link is
   * `program_heads` on the server, which is what the HOD role's scoping reads — a
   * programme can have a named head on the prospectus before that person has a login.
   */
  head_of_department: string | null;
  /** D45 §8 — office location / hours / contact. Free text (client, 2026-09-08). */
  office_information: string | null;
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
  // D44. Sending `null` explicitly CLEARS these; omitting leaves them alone (the server
  // reads `exclude_unset` for the three, unlike the older fields above).
  admission_requirements?: string | null;
  graduation_requirements?: string | null;
  comments?: string | null;
  // D45 §8. Same rule: explicit `null` clears, omitting leaves alone.
  head_of_department?: string | null;
  office_information?: string | null;
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
  /** Equality filter. `true` = active only, `false` = RETIRED only. Omitting it does
   *  NOT mean "both" — the server defaults it to `true`, which is what made the
   *  Programmes screen's "Show retired" switch inert. */
  is_active?: boolean;
  /** Drop the `is_active` filter entirely and return active AND retired. This is what
   *  "Show retired" needs; it wins over `is_active` when both are sent. */
  include_retired?: boolean;
}

// ── Heads of Department (D43) ──────────────────────────────────────────────────
/** One head of a programme, named well enough to render without a second call. */
export interface ProgramHeadItem {
  teacher_id: string;
  full_name: string;
  staff_number: string;
  /**
   * The head's LOGIN role. A lecturer can be appointed here while their role is still
   * `teacher` — appointing the head and granting the reach are two separate acts, and
   * the screen shows that gap rather than implying the appointment did something it
   * did not.
   */
  role: string | null;
  appointed_at: string | null;
}

export interface ProgramHeadsResponse {
  items: ProgramHeadItem[];
}
