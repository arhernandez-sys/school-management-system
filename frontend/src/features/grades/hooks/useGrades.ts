/**
 * Grades data hooks (api-spec §5.7). TanStack Query wrappers over the grades transport.
 *
 * - `useOfferingOptions` / `useGradebook` are reads.
 * - `useSaveGrades` bulk-saves one assessment column, then invalidates the gradebook so
 *   term grades recompute (compute-on-read, architecture §7.1). The whole column is a
 *   single write, so an optimistic patch would have to reconcile every cell against the
 *   server's recomputed term grades — instead we invalidate-and-refetch, which keeps the
 *   term-grade math authoritative in one place (the selector) and cannot drift.
 * - `useSetRelease` flips an assessment's release flag and refreshes.
 *
 * **D31** — the picker and the gradebook are keyed by `offeringId`, not `classSubjectId`.
 * The query keys changed with them, which is why a cached pre-D31 gradebook cannot be
 * served under a new key.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchGradebook,
  fetchMyGrades,
  fetchOfferingOptions,
  saveAssessmentGrades,
  setAssessmentRelease,
} from '../api/gradesApi';
import type { GradeEntry } from '../types';

export const gradeKeys = {
  all: ['grades'] as const,
  offeringOptions: (academicYearId?: string | null) =>
    [...gradeKeys.all, 'offerings', academicYearId ?? null] as const,
  gradebook: (offeringId: string) => [...gradeKeys.all, 'gradebook', offeringId] as const,
  // Both period ids are part of the key — this is what makes the global switcher
  // actually refetch instead of serving the previously-selected period from cache.
  me: (academicYearId?: string | null, semesterId?: string | null) =>
    [...gradeKeys.all, 'me', academicYearId ?? null, semesterId ?? null] as const,
};

/** GET /grades/offerings — the picker (lecturer own / Dean·Registrar all), year-scoped. */
export function useOfferingOptions(academicYearId?: string) {
  return useQuery({
    queryKey: gradeKeys.offeringOptions(academicYearId),
    queryFn: ({ signal }) => fetchOfferingOptions(academicYearId, signal),
  });
}

/** GET /grades/offering/{id}. Disabled until an offering is chosen. */
export function useGradebook(offeringId: string | null) {
  return useQuery({
    queryKey: gradeKeys.gradebook(offeringId ?? ''),
    queryFn: ({ signal }) => fetchGradebook(offeringId as string, signal),
    enabled: Boolean(offeringId),
  });
}

/** PUT /assessments/{id}/grades — save one assessment column. */
export function useSaveGrades(offeringId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assessmentId, entries }: { assessmentId: string; entries: GradeEntry[] }) =>
      saveAssessmentGrades(assessmentId, entries),
    onSuccess: () => {
      if (offeringId) {
        void qc.invalidateQueries({ queryKey: gradeKeys.gradebook(offeringId) });
      }
      void qc.invalidateQueries({ queryKey: [...gradeKeys.all, 'me'] });
    },
  });
}

/** POST /assessments/{id}/release|unrelease. */
export function useSetRelease(offeringId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assessmentId, release }: { assessmentId: string; release: boolean }) =>
      setAssessmentRelease(assessmentId, release),
    onSuccess: () => {
      if (offeringId) {
        void qc.invalidateQueries({ queryKey: gradeKeys.gradebook(offeringId) });
      }
      void qc.invalidateQueries({ queryKey: [...gradeKeys.all, 'me'] });
    },
  });
}

/** GET /grades/me — the student's own released grades (year-scoped). */
export function useMyGrades(academicYearId?: string, semesterId?: string) {
  return useQuery({
    queryKey: gradeKeys.me(academicYearId, semesterId),
    queryFn: ({ signal }) => fetchMyGrades(academicYearId, semesterId, signal),
  });
}
