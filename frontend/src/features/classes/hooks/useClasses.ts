/**
 * Classes data hooks (api-spec §5). Thin TanStack Query wrappers over the shared axios
 * client (`@shared/api/client`) — the Classes endpoints are not in the orval-generated
 * surface yet, so these call the transport directly (Bearer + refresh + credentialed
 * cookie still ride the shared `api` instance).
 *
 * Query keys embed their params so the cache stays correct across search / pagination.
 * Mutations invalidate the affected class's reads (roster, subjects, detail, list).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type {
  ClassDetail,
  ClassListParams,
  ClassListResponse,
  ClassSubjectItem,
  EnrollmentResult,
  RosterEntry,
  StudentRef,
} from '../types';

export const classKeys = {
  all: ['classes'] as const,
  list: (params: ClassListParams) => [...classKeys.all, 'list', params] as const,
  detail: (id: string) => [...classKeys.all, 'detail', id] as const,
  subjects: (id: string) => [...classKeys.all, id, 'subjects'] as const,
  roster: (id: string) => [...classKeys.all, id, 'roster'] as const,
  enrollable: (id: string, search: string) =>
    [...classKeys.all, id, 'enrollable', search] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
/** GET /classes — paginated sections list. */
export function useClassesList(params: ClassListParams) {
  return useQuery({
    queryKey: classKeys.list(params),
    queryFn: async ({ signal }) => {
      const res = await api.get<ClassListResponse>('/classes', { params, signal });
      return res.data;
    },
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/** GET /classes/{id} — section detail. */
export function useClassDetail(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.detail(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<ClassDetail>(`/classes/${classId}`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/subjects — class_subjects offered in the section. */
export function useClassSubjects(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.subjects(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<ClassSubjectItem[]>(`/classes/${classId}/subjects`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/roster — active roster (not paginated). */
export function useClassRoster(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.roster(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<RosterEntry[]>(`/classes/${classId}/roster`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/enrollable-students — picker for the enroll dialog. */
export function useEnrollableStudents(classId: string | undefined, search: string, enabled: boolean) {
  return useQuery({
    queryKey: classKeys.enrollable(classId ?? '', search),
    enabled: enabled && Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: StudentRef[] }>(
        `/classes/${classId}/enrollable-students`,
        { params: search ? { search } : undefined, signal },
      );
      return res.data.items;
    },
    placeholderData: (prev) => prev,
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────
/** POST /classes/{id}/enrollments — enroll one or more students (bulk). */
export function useEnrollStudents(classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentIds: string[]) => {
      const res = await api.post<EnrollmentResult>(`/classes/${classId}/enrollments`, {
        student_ids: studentIds,
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classKeys.roster(classId) });
      void qc.invalidateQueries({ queryKey: classKeys.detail(classId) });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, classId, 'enrollable'] });
    },
  });
}

/** DELETE /classes/{id}/enrollments/{enrollmentId} — withdraw from the roster. */
export function useWithdrawStudent(classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      await api.delete(`/classes/${classId}/enrollments/${enrollmentId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classKeys.roster(classId) });
      void qc.invalidateQueries({ queryKey: classKeys.detail(classId) });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, classId, 'enrollable'] });
    },
  });
}
