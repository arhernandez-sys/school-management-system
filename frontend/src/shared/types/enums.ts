/**
 * Enums mirroring the Postgres native enums (api-specification.md §4.5).
 *
 * `Role` is now RE-EXPORTED from the orval-generated client (the auth OpenAPI
 * defines it), so the role vocabulary cannot drift from the backend. The remaining
 * enums below are still hand-authored — their owning modules (Students, Assessments,
 * …) are not yet in the served OpenAPI; they will be re-sourced from codegen as those
 * endpoints land. All are string-literal unions (not TS `enum`s) so they serialize/
 * compare to the exact lowercase wire labels with zero runtime cost.
 */

// Generated role vocabulary (single source of truth). Re-exported as a type so all
// existing `import type { Role } from '@shared/types/enums'` sites keep working.
export type { Role } from '@shared/api/generated/model';
import type { Role } from '@shared/api/generated/model';

export type StudentStatus = 'active' | 'inactive' | 'transferred' | 'graduated' | 'withdrawn';

export type TeacherStatus = 'active' | 'inactive';

export type AcademicYearStatus = 'active' | 'archived';

export type AssessmentType = 'quiz' | 'test' | 'exam' | 'assignment';

export type AssessmentStatus = 'draft' | 'published' | 'grading' | 'graded';

export type GradeStatus = 'pending' | 'graded' | 'absent' | 'excused' | 'exempt';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type AnnouncementAudience = 'all' | 'students' | 'teachers' | 'class';

/** All roles, ordered for display/iteration. */
export const ROLES: readonly Role[] = ['principal', 'secretary', 'teacher', 'student'];
