/**
 * Course-prerequisite wire types (D30 §D4).
 *
 * Hand-written: the endpoints are new and are not in the served `openapi.json`, and
 * `npm run generate:api` is forbidden. Same arrangement as Students and Programmes.
 */

export type PrerequisiteType = 'course' | 'all_program_courses';

export interface PrerequisiteCourseRef {
  id: string;
  code: string;
  name: string;
}

export interface PrerequisiteProgramRef {
  id: string;
  code: string;
  name: string;
}

/** One requirement standing in front of a course. */
export interface PrerequisiteItem {
  id: string;
  requirement_type: PrerequisiteType;
  /** NULL for `all_program_courses`, where the gate is the whole programme. */
  prerequisite_course: PrerequisiteCourseRef | null;
  /** NULL = the requirement applies wherever the course is taken. */
  program: PrerequisiteProgramRef | null;
}

export interface PrerequisiteList {
  items: PrerequisiteItem[];
  /**
   * The raw string from the course-sequence PDF. DOCUMENTATION ONLY — the gate reads
   * `items`. Surfaced so a Dean entering the relation can check it against what the
   * source actually said.
   *
   * D45 §3b P1: the server CLEARS this when the last structured requirement is removed.
   * Leaving it behind made a successful delete look like it had failed — the dialog went
   * on printing "MATH1110" after the rule was gone.
   */
  prerequisites_text: string | null;
  /**
   * D45 §3b P3 — courses that require THIS one. Read-only.
   *
   * The dialog could only ever answer "what does this course require", so a Dean trying
   * to open Calculus 1 for enrolment would open Pre-Calculus — the previous course, the
   * one named in the error — and remove ITS requirement, which changes nothing. The rule
   * that blocks a course is always stored ON that course.
   */
  required_by: PrerequisiteCourseRef[];
}

export interface PrerequisiteCreatePayload {
  requirement_type?: PrerequisiteType;
  prerequisite_course_id?: string | null;
  program_id?: string | null;
}
