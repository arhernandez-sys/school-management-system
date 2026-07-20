/**
 * Grades module wire types (api-spec §5.7). These mirror the shapes the demo MSW
 * grades handler returns; the screens are typed strictly against them. Letter grades
 * are plain strings (derived-on-read from the configurable scale, D11 — never an enum).
 */
import type { AssessmentType, GradeStatus } from '@shared/types/enums';

export interface SectionRef {
  id: string;
  name: string;
  grade_level: string;
  /** Division letter within the grade/form (e.g. "A"). Drives the P/S section filter. */
  section: string;
}

export interface SubjectRef {
  id: string;
  name: string;
  code: string;
}

export interface TeacherRef {
  id: string;
  full_name: string;
}

export interface ClassSubjectRef {
  id: string;
  section: SectionRef | null;
  subject: SubjectRef | null;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  display_name: string;
}

/** A class_subject option in the gradebook picker. */
export interface ClassSubjectOption extends ClassSubjectRef {
  assessment_count: number;
  /** Whether the CURRENT caller may enter grades in this offering. */
  can_edit: boolean;
}

export interface ClassSubjectOptionsResponse {
  items: ClassSubjectOption[];
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
  class_subject: ClassSubjectRef | null;
  semester: { id: string; name: string; sequence: number } | null;
  assessments: GradebookAssessment[];
  categories: GradebookCategory[];
  rows: GradebookRow[];
  drop_lowest_applied: boolean;
  /** Whether the current viewer may write (teacher owns it). */
  can_edit: boolean;
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

export interface MyGradeSubject {
  class_subject: ClassSubjectRef | null;
  teacher: TeacherRef | null;
  assessments: MyGradeAssessment[];
  term_numeric: number | null;
  term_letter: string | null;
}

export interface MyGrades {
  student: StudentRef;
  by_subject: MyGradeSubject[];
}
