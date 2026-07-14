/**
 * Reports data hooks (TanStack Query over the shared axios client). Query keys are
 * namespaced under 'reports' so they invalidate independently of other modules.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchActiveTerm,
  fetchMyReportCard,
  fetchReportCard,
  fetchReportStudents,
  fetchSemesters,
  fetchTranscript,
  type StudentPickerParams,
} from '../api/reportsApi';

const CONFIG_STALE_MS = 5 * 60 * 1000;

// ── Student picker ─────────────────────────────────────────────────────────────
export function useReportStudents(params: StudentPickerParams) {
  return useQuery({
    queryKey: ['reports', 'students', params],
    queryFn: () => fetchReportStudents(params),
    placeholderData: keepPreviousData,
  });
}

// ── Term picker sources ─────────────────────────────────────────────────────────
export function useActiveTerm() {
  return useQuery({
    queryKey: ['reports', 'active-term'],
    queryFn: fetchActiveTerm,
    staleTime: CONFIG_STALE_MS,
    retry: false,
  });
}

export function useSemesters(academicYearId?: string) {
  return useQuery({
    queryKey: ['reports', 'semesters', academicYearId ?? null],
    queryFn: () => fetchSemesters(academicYearId),
    staleTime: CONFIG_STALE_MS,
  });
}

// ── Report card ──────────────────────────────────────────────────────────────────
/** Report card for a chosen student (P/S/teacher). Disabled until a student is picked. */
export function useReportCard(studentId: string | null, semesterId?: string) {
  return useQuery({
    queryKey: ['reports', 'report-card', studentId, semesterId ?? null],
    queryFn: () => fetchReportCard(studentId as string, semesterId),
    enabled: Boolean(studentId),
  });
}

/** The signed-in student's own report card (student role → /me). */
export function useMyReportCard(semesterId?: string) {
  return useQuery({
    queryKey: ['reports', 'report-card', 'me', semesterId ?? null],
    queryFn: () => fetchMyReportCard(semesterId),
  });
}

// ── Transcript (P/S only) ─────────────────────────────────────────────────────────
export function useTranscript(studentId: string | null) {
  return useQuery({
    queryKey: ['reports', 'transcript', studentId],
    queryFn: () => fetchTranscript(studentId as string),
    enabled: Boolean(studentId),
  });
}
