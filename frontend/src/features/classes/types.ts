/**
 * Classes module wire types (api-spec §5). These mirror the MSW handler response
 * shapes in `mocks/handlers/classes.ts` exactly (snake_case). The Classes endpoints
 * are not in the auth-only OpenAPI surface yet, so there are no orval-generated
 * models to import — these hand-authored types are the local contract until they are.
 */
import type { Page } from '@shared/types/api';

export interface SubjectRef {
  id: string;
  name: string;
  code: string;
}

export interface TeacherRef {
  id: string;
  full_name: string;
}

export interface StudentRef {
  id: string;
  full_name: string;
  student_number: string;
}

export interface AcademicYearRef {
  id: string;
  name: string;
  status: string;
}

/** Row in GET /classes. */
export interface ClassListItem {
  id: string;
  name: string;
  grade_level: string;
  section: string;
  capacity: number;
  enrolled_count: number;
  subject_count: number;
  is_archived: boolean;
}

/** GET /classes/{id}. `over_capacity` is the warn-only state flag (D-Q6). */
export interface ClassDetail {
  id: string;
  name: string;
  grade_level: string;
  section: string;
  capacity: number;
  academic_year: AcademicYearRef;
  enrolled_count: number;
  over_capacity: boolean;
  is_archived: boolean;
}

/** Row in GET /classes/{id}/subjects. */
export interface ClassSubjectItem {
  class_subject_id: string;
  subject: SubjectRef;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  assessment_count: number;
  is_active: boolean;
  actionable_by_caller: boolean;
}

/** Row in GET /classes/{id}/roster. */
export interface RosterEntry {
  enrollment_id: string;
  student: StudentRef;
  enrolled_at: string;
  unenrolled_at: string | null;
}

/** Result of POST /classes/{id}/enrollments. */
export interface EnrollmentResult {
  enrolled: RosterEntry[];
  transferred: Array<{ student_id: string; from_class_id: string }>;
  /** Per-mutation feedback: the enroll pushed the section over capacity (warn-only). */
  over_capacity_warning: boolean;
}

/** POST /classes request body. */
export interface ClassCreateBody {
  name: string;
  grade_level: string;
  section: string;
  capacity: number;
  academic_year_id: string;
}

export interface ClassListParams {
  academic_year_id?: string;
  grade_level?: string;
  search?: string;
  page?: number;
  page_size?: number;
  sort?: string;
}

export type ClassListResponse = Page<ClassListItem>;
