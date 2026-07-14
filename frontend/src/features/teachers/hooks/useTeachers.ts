/**
 * Teachers data hooks (api-spec §5 Module 4). Thin TanStack Query wrappers over the
 * `teachersApi` transport (which rides the shared axios client). Query keys embed their
 * params so the cache stays correct across search / filter / pagination; mutations
 * invalidate the affected teacher's reads (detail + the whole list).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTeacher,
  deleteTeacher,
  getTeacher,
  listTeachers,
  setTeacherStatus,
  updateTeacher,
} from '../api/teachersApi';
import type { TeacherCreateBody, TeacherUpdateBody, TeachersListParams } from '../types';
import type { TeacherStatus } from '@shared/types/enums';

export const teacherKeys = {
  all: ['teachers'] as const,
  list: (params: TeachersListParams) => [...teacherKeys.all, 'list', params] as const,
  detail: (id: string) => [...teacherKeys.all, 'detail', id] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
/** GET /teachers — paginated directory. */
export function useTeachersList(params: TeachersListParams) {
  return useQuery({
    queryKey: teacherKeys.list(params),
    queryFn: ({ signal }) => listTeachers(params, signal),
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/** GET /teachers/{id} — full detail incl. classes_taught. */
export function useTeacherDetail(teacherId: string | undefined) {
  return useQuery({
    queryKey: teacherKeys.detail(teacherId ?? ''),
    enabled: Boolean(teacherId),
    queryFn: ({ signal }) => getTeacher(teacherId as string, signal),
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────
/** POST /teachers — create profile (+ optional linked login → one-time temp password). */
export function useCreateTeacher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TeacherCreateBody) => createTeacher(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...teacherKeys.all, 'list'] });
    },
  });
}

/** PATCH /teachers/{id} — benign profile edits. */
export function useUpdateTeacher(teacherId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TeacherUpdateBody) => updateTeacher(teacherId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teacherKeys.detail(teacherId) });
      void qc.invalidateQueries({ queryKey: [...teacherKeys.all, 'list'] });
    },
  });
}

/** POST /teachers/{id}/status — activate/deactivate (409 if active assignments). */
export function useSetTeacherStatus(teacherId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TeacherStatus) => setTeacherStatus(teacherId, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teacherKeys.detail(teacherId) });
      void qc.invalidateQueries({ queryKey: [...teacherKeys.all, 'list'] });
    },
  });
}

/** DELETE /teachers/{id} — hard delete (409 if assigned). */
export function useDeleteTeacher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teacherId: string) => deleteTeacher(teacherId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...teacherKeys.all, 'list'] });
    },
  });
}
