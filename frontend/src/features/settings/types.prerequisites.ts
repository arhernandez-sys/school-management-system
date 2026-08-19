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
   */
  prerequisites_text: string | null;
}

export interface PrerequisiteCreatePayload {
  requirement_type?: PrerequisiteType;
  prerequisite_course_id?: string | null;
  program_id?: string | null;
}
