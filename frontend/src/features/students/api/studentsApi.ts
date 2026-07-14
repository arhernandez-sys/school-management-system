import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type {
  StudentAssessmentGroup,
  StudentDetail,
  StudentListItem,
  StudentWritePayload,
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

/** GET /students/{id} — full detail. */
export async function getStudent(id: string, signal?: AbortSignal): Promise<StudentDetail> {
  const res = await api.get<StudentDetail>(`/students/${id}`, { signal });
  return res.data;
}

/** GET /students/me — the acting student's own record. */
export async function getMyStudentRecord(signal?: AbortSignal): Promise<StudentDetail> {
  const res = await api.get<StudentDetail>('/students/me', { signal });
  return res.data;
}

/** GET /students/{id}/assessments — assessments grouped by subject, with term grades. */
export async function getStudentAssessments(
  id: string,
  signal?: AbortSignal,
): Promise<StudentAssessmentGroup[]> {
  const res = await api.get<{ items: StudentAssessmentGroup[] }>(`/students/${id}/assessments`, {
    signal,
  });
  return res.data.items;
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
