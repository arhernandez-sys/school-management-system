import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type {
  NudgeReleaseResult,
  StudentAssessmentsResponse,
  StudentDetail,
  StudentListItem,
  StudentWritePayload,
  StudentYear,
  StudentsListParams,
} from '../types';
import type { StudentStatus } from '@shared/types/enums';

/**
 * Students transport (api-spec §5 Module 3). Calls the shared axios `client` directly
 * (Bearer + single-flight refresh + credentialed cookie ride along) because the Students
 * endpoints aren't in the served OpenAPI yet, so there are no orval hooks. When codegen
 * catches up, swap the bodies for the generated operations — the hook layer and screens
 * won't change.
 */

/** GET /students — searchable, filterable, paginated directory. */
export async function listStudents(
  params: StudentsListParams,
  signal?: AbortSignal,
): Promise<Page<StudentListItem>> {
  const res = await api.get<Page<StudentListItem>>('/students', { params, signal });
  return res.data;
}

/** GET /students/{id} — full detail. `academicYearId` scopes the section to that year. */
export async function getStudent(
  id: string,
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<StudentDetail> {
  const res = await api.get<StudentDetail>(`/students/${id}`, {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** GET /students/{id}/years — academic years the student was enrolled in (newest first). */
export async function getStudentYears(id: string, signal?: AbortSignal): Promise<StudentYear[]> {
  const res = await api.get<{ items: StudentYear[] }>(`/students/${id}/years`, { signal });
  return res.data.items;
}

/** GET /students/me — the acting student's own record. */
export async function getMyStudentRecord(signal?: AbortSignal): Promise<StudentDetail> {
  const res = await api.get<StudentDetail>('/students/me', { signal });
  return res.data;
}

/**
 * GET /students/{id}/assessments — assessments grouped by subject, with term grades.
 *
 * Returns the WHOLE envelope rather than just `items`: the response also carries
 * `nudge_cooldown_seconds`, which the Grades tab needs to decide whether the
 * "Remind teacher" action is still inside its cooldown.
 */
export async function getStudentAssessments(
  id: string,
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<StudentAssessmentsResponse> {
  const res = await api.get<StudentAssessmentsResponse>(`/students/${id}/assessments`, {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/**
 * POST /assessments/{id}/nudge-release — remind the teacher to release this
 * assessment's grades. Principal/secretary only.
 *
 * Errors worth handling at the call site: 409 `nothing_awaiting_release` (nothing
 * is marked-and-hidden), 409 `no_assigned_teacher`, 429 `rate_limited` (inside the
 * cooldown — the UI should normally prevent this by disabling the control).
 */
export async function nudgeRelease(assessmentId: string): Promise<NudgeReleaseResult> {
  const res = await api.post<NudgeReleaseResult>(`/assessments/${assessmentId}/nudge-release`);
  return res.data;
}

/** POST /students — create a student profile (+ optional section enroll). */
export async function createStudent(body: StudentWritePayload): Promise<StudentDetail> {
  const res = await api.post<StudentDetail>('/students', body);
  return res.data;
}

/** PATCH /students/{id} — benign profile edits. */
export async function updateStudent(
  id: string,
  body: Partial<StudentWritePayload>,
): Promise<StudentDetail> {
  const res = await api.patch<StudentDetail>(`/students/${id}`, body);
  return res.data;
}

/** POST /students/{id}/status — lifecycle transition (422 invalid_transition). */
export async function setStudentStatus(id: string, status: StudentStatus): Promise<StudentDetail> {
  const res = await api.post<StudentDetail>(`/students/${id}/status`, { status });
  return res.data;
}

/** DELETE /students/{id} — hard delete (409 has_academic_history). */
export async function deleteStudent(id: string): Promise<void> {
  await api.delete(`/students/${id}`);
}
