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
  getTeacherYears,
  listTeachers,
  setTeacherStatus,
  updateTeacher,
} from '../api/teachersApi';
import type { TeacherCreateBody, TeacherUpdateBody, TeachersListParams } from '../types';
import type { TeacherStatus } from '@shared/types/enums';

export const teacherKeys = {
  all: ['teachers'] as const,
  list: (params: TeachersListParams) => [...teacherKeys.all, 'list', params] as const,
  /**
   * The YEAR is part of the key (D42 §2), not just the request. Two years' assignments are
   * two different answers for the same lecturer, and sharing one cache entry would show
   * last year's courses for an instant after every switch — the same reasoning that put
   * `kind` in the report-card key.
   */
  detail: (id: string, yearId?: string) =>
    [...teacherKeys.all, 'detail', id, yearId ?? null] as const,
  years: (id: string) => [...teacherKeys.all, 'years', id] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
/**
 * GET /teachers — paginated directory. `enabled` defers the fetch for consumers that
 * mount the hook before it is needed (e.g. a closed picker dialog); list screens omit it.
 */
export function useTeachersList(params: TeachersListParams, enabled = true) {
  return useQuery({
    queryKey: teacherKeys.list(params),
    enabled,
    queryFn: ({ signal }) => listTeachers(params, signal),
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/**
 * GET /teachers/{id} — full detail incl. classes_taught, optionally year-scoped.
 *
 * `enabled` exists for the profile's year switcher (D42 §2). The selected year is resolved
 * from `useTeacherYears`, so on the first render it is still `undefined` — and an UNSCOPED
 * read is not a harmless approximation of the scoped one here: it returns every assignment
 * the lecturer has ever held. Firing it would flash all years' courses under a switcher
 * already displaying one year, then quietly swap them. The profile therefore waits for the
 * years, and asks once.
 *
 * (The student profile deliberately does NOT do this: its unscoped read answers the ACTIVE
 * semester, which is what the switcher lands on anyway, so there is nothing to flash.)
 */
export function useTeacherDetail(
  teacherId: string | undefined,
  academicYearId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: teacherKeys.detail(teacherId ?? '', academicYearId),
    enabled: Boolean(teacherId) && enabled,
    queryFn: ({ signal }) => getTeacher(teacherId as string, academicYearId, signal),
    // Keep the previous year's answer on screen while the next one loads, so switching
    // year does not blank the whole profile body between two renders.
    placeholderData: (prev) => prev,
  });
}

/** GET /teachers/{id}/years — the years this lecturer taught in (for the year switcher). */
export function useTeacherYears(teacherId: string | undefined) {
  return useQuery({
    queryKey: teacherKeys.years(teacherId ?? ''),
    enabled: Boolean(teacherId),
    queryFn: ({ signal }) => getTeacherYears(teacherId as string, signal),
    staleTime: 5 * 60 * 1000, // a lecturer's teaching history is stable within a session
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
      void qc.invalidateQueries({ queryKey: [...teacherKeys.all, 'detail', teacherId] });
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
      void qc.invalidateQueries({ queryKey: [...teacherKeys.all, 'detail', teacherId] });
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
