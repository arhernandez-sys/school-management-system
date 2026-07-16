/**
 * Grades data hooks (api-spec §5.7). TanStack Query wrappers over the grades transport.
 *
 * - `useClassSubjectOptions` / `useGradebook` are reads.
 * - `useSaveGrades` bulk-saves one assessment column, then invalidates the gradebook so
 *   term grades recompute (compute-on-read, architecture §7.1). The whole column is a
 *   single write, so an optimistic patch would have to reconcile every cell against the
 *   server's recomputed term grades — instead we invalidate-and-refetch, which keeps the
 *   term-grade math authoritative in one place (the selector) and cannot drift.
 * - `useSetRelease` flips an assessment's release flag and refreshes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchClassSubjectOptions,
  fetchGradebook,
  fetchMyGrades,
  saveAssessmentGrades,
  setAssessmentRelease,
} from '../api/gradesApi';
import type { GradeEntry } from '../types';

export const gradeKeys = {
  all: ['grades'] as const,
  classSubjectOptions: (academicYearId?: string | null) =>
    [...gradeKeys.all, 'class-subjects', academicYearId ?? null] as const,
  gradebook: (classSubjectId: string) => [...gradeKeys.all, 'gradebook', classSubjectId] as const,
  me: () => [...gradeKeys.all, 'me'] as const,
};

/** GET /grades/class-subjects — the picker (teacher own / P·S all), year-scoped. */
export function useClassSubjectOptions(academicYearId?: string) {
  return useQuery({
    queryKey: gradeKeys.classSubjectOptions(academicYearId),
    queryFn: ({ signal }) => fetchClassSubjectOptions(academicYearId, signal),
  });
}

/** GET /grades/class-subject/{id}. Disabled until a class_subject is chosen. */
export function useGradebook(classSubjectId: string | null) {
  return useQuery({
    queryKey: gradeKeys.gradebook(classSubjectId ?? ''),
    queryFn: ({ signal }) => fetchGradebook(classSubjectId as string, signal),
    enabled: Boolean(classSubjectId),
  });
}

/** PUT /assessments/{id}/grades — save one assessment column. */
export function useSaveGrades(classSubjectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assessmentId, entries }: { assessmentId: string; entries: GradeEntry[] }) =>
      saveAssessmentGrades(assessmentId, entries),
    onSuccess: () => {
      if (classSubjectId) {
        void qc.invalidateQueries({ queryKey: gradeKeys.gradebook(classSubjectId) });
      }
      void qc.invalidateQueries({ queryKey: gradeKeys.me() });
    },
  });
}

/** POST /assessments/{id}/release|unrelease. */
export function useSetRelease(classSubjectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assessmentId, release }: { assessmentId: string; release: boolean }) =>
      setAssessmentRelease(assessmentId, release),
    onSuccess: () => {
      if (classSubjectId) {
        void qc.invalidateQueries({ queryKey: gradeKeys.gradebook(classSubjectId) });
      }
      void qc.invalidateQueries({ queryKey: gradeKeys.me() });
    },
  });
}

/** GET /grades/me — the student's own released grades. */
export function useMyGrades() {
  return useQuery({
    queryKey: gradeKeys.me(),
    queryFn: ({ signal }) => fetchMyGrades(signal),
  });
}
