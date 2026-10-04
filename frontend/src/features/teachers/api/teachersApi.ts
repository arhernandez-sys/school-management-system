import { api } from '@shared/api/client';
import type {
  Page,
  TeacherCreateBody,
  TeacherCreateResult,
  TeacherDetail,
  TeacherListItem,
  TeacherUpdateBody,
  TeacherYear,
  TeachersListParams,
} from '../types';
import type { TeacherStatus } from '@shared/types/enums';

/**
 * Teachers transport (api-spec §5 Module 4). These call the shared axios `client`
 * directly (Bearer + single-flight refresh + credentialed cookie ride along) because
 * the Teachers endpoints aren't in the served OpenAPI yet, so there are no orval hooks.
 * When codegen catches up, swap the bodies for the generated operations — the hook layer
 * and screens won't change.
 */

/** GET /teachers — searchable, paginated directory. */
export async function listTeachers(
  params: TeachersListParams,
  signal?: AbortSignal,
): Promise<Page<TeacherListItem>> {
  const res = await api.get<Page<TeacherListItem>>('/teachers', { params, signal });
  return res.data;
}

/**
 * GET /teachers/{id} — full detail incl. classes_taught.
 *
 * `academicYearId` scopes `classes_taught` to one year (D42 §2). Omitted, every assignment
 * the lecturer holds comes back — which is what the create/edit flows want.
 */
export async function getTeacher(
  id: string,
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<TeacherDetail> {
  const res = await api.get<TeacherDetail>(`/teachers/${id}`, {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** GET /teachers/{id}/years — the academic years this lecturer taught in (newest first). */
export async function getTeacherYears(
  id: string,
  signal?: AbortSignal,
): Promise<TeacherYear[]> {
  const res = await api.get<{ items: TeacherYear[] }>(`/teachers/${id}/years`, { signal });
  return res.data.items;
}

/** POST /teachers — create profile (+ optional linked login). */
export async function createTeacher(body: TeacherCreateBody): Promise<TeacherCreateResult> {
  const res = await api.post<TeacherCreateResult>('/teachers', body);
  return res.data;
}

/** PATCH /teachers/{id} — benign profile edits. */
export async function updateTeacher(
  id: string,
  body: TeacherUpdateBody,
): Promise<TeacherDetail> {
  const res = await api.patch<TeacherDetail>(`/teachers/${id}`, body);
  return res.data;
}

/** POST /teachers/{id}/status — activate/deactivate. */
export async function setTeacherStatus(
  id: string,
  status: TeacherStatus,
): Promise<TeacherDetail> {
  const res = await api.post<TeacherDetail>(`/teachers/${id}/status`, { status });
  return res.data;
}

/** DELETE /teachers/{id} — hard delete (409 if assigned). */
export async function deleteTeacher(id: string): Promise<void> {
  await api.delete(`/teachers/${id}`);
}
