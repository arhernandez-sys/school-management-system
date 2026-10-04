import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type {
  ClassroomDetail,
  ClassroomListItem,
  ClassroomWritePayload,
  ClassroomsListParams,
} from '../types';

/**
 * Classrooms transport (D44). Calls the shared axios `client` directly — these endpoints
 * are not in the served OpenAPI, so there are no orval hooks and `npm run generate:api`
 * is forbidden. Same arrangement as Programmes and Students.
 */
export async function listClassrooms(
  params: ClassroomsListParams,
  signal?: AbortSignal,
): Promise<Page<ClassroomListItem>> {
  const res = await api.get<Page<ClassroomListItem>>('/classrooms', { params, signal });
  return res.data;
}

export async function getClassroom(
  id: string,
  signal?: AbortSignal,
): Promise<ClassroomDetail> {
  const res = await api.get<ClassroomDetail>(`/classrooms/${id}`, { signal });
  return res.data;
}

export async function createClassroom(
  body: ClassroomWritePayload,
): Promise<ClassroomDetail> {
  const res = await api.post<ClassroomDetail>('/classrooms', body);
  return res.data;
}

export async function updateClassroom(
  id: string,
  body: ClassroomWritePayload,
): Promise<ClassroomDetail> {
  const res = await api.patch<ClassroomDetail>(`/classrooms/${id}`, body);
  return res.data;
}

/**
 * HARD delete — a room carries no history worth keeping and no report ever names one.
 *
 * The server answers 409 `classroom_in_use` while any live offering is scheduled there,
 * rather than letting the `ON DELETE SET NULL` quietly unroom them.
 */
export async function deleteClassroom(id: string): Promise<void> {
  await api.delete(`/classrooms/${id}`);
}
