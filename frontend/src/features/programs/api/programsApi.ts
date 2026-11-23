import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type {
  ProgramCourseUpdatePayload,
  ProgramCourseWritePayload,
  ProgramDetail,
  ProgramHeadsResponse,
  ProgramListItem,
  ProgramWritePayload,
  ProgramsListParams,
} from '../types';

/**
 * Programmes transport (D30 §D3). Calls the shared axios `client` directly — the
 * programmes endpoints are not in the served OpenAPI, so there are no orval hooks and
 * `npm run generate:api` is forbidden. Same arrangement as the Students feature.
 *
 * The three curriculum writes return the WHOLE programme, not the touched row: each
 * changes the affected block's credit total and the programme's curriculum total, so
 * the builder would otherwise have to re-fetch after every edit.
 */
export async function listPrograms(
  params: ProgramsListParams,
  signal?: AbortSignal,
): Promise<Page<ProgramListItem>> {
  const res = await api.get<Page<ProgramListItem>>('/programs', { params, signal });
  return res.data;
}

export async function getProgram(id: string, signal?: AbortSignal): Promise<ProgramDetail> {
  const res = await api.get<ProgramDetail>(`/programs/${id}`, { signal });
  return res.data;
}

export async function createProgram(body: ProgramWritePayload): Promise<ProgramDetail> {
  const res = await api.post<ProgramDetail>('/programs', body);
  return res.data;
}

export async function updateProgram(
  id: string,
  body: Partial<ProgramWritePayload>,
): Promise<ProgramDetail> {
  const res = await api.patch<ProgramDetail>(`/programs/${id}`, body);
  return res.data;
}

export async function deleteProgram(id: string): Promise<void> {
  await api.delete(`/programs/${id}`);
}

export async function addProgramCourse(
  programId: string,
  body: ProgramCourseWritePayload,
): Promise<ProgramDetail> {
  const res = await api.post<ProgramDetail>(`/programs/${programId}/courses`, body);
  return res.data;
}

export async function updateProgramCourse(
  programId: string,
  programCourseId: string,
  body: ProgramCourseUpdatePayload,
): Promise<ProgramDetail> {
  const res = await api.patch<ProgramDetail>(
    `/programs/${programId}/courses/${programCourseId}`,
    body,
  );
  return res.data;
}

export async function removeProgramCourse(
  programId: string,
  programCourseId: string,
): Promise<ProgramDetail> {
  const res = await api.delete<ProgramDetail>(
    `/programs/${programId}/courses/${programCourseId}`,
  );
  return res.data;
}

/** GET /programs/{id}/heads — who heads this programme (D43). */
export async function getProgramHeads(
  programId: string,
  signal?: AbortSignal,
): Promise<ProgramHeadsResponse> {
  const res = await api.get<ProgramHeadsResponse>(`/programs/${programId}/heads`, { signal });
  return res.data;
}

/**
 * PUT /programs/{id}/heads — replace the appointments (Dean only).
 *
 * A whole-list PUT, not add/remove: the screen edits a multi-select and submits it, and
 * swapping two co-heads in one action would otherwise be an add plus a delete that can
 * half-fail. `[]` clears the appointments.
 */
export async function setProgramHeads(
  programId: string,
  teacherIds: string[],
): Promise<ProgramHeadsResponse> {
  const res = await api.put<ProgramHeadsResponse>(`/programs/${programId}/heads`, {
    teacher_ids: teacherIds,
  });
  return res.data;
}
