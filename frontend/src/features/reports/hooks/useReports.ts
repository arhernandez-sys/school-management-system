/**
 * Reports data hooks (TanStack Query over the shared axios client). Query keys are
 * namespaced under 'reports' so they invalidate independently of other modules.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchActiveTerm,
  fetchCreditLoad,
  fetchMyReportCard,
  fetchNewVsReturning,
  fetchOvercapacity,
  fetchProgrammeAttendance,
  fetchReportCard,
  fetchReportStudents,
  fetchSemesters,
  fetchTranscript,
  type StudentPickerParams,
} from '../api/reportsApi';
import type { ReportCardKind } from '../types';

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
/**
 * D32 — `kind` is part of the query KEY, not just the request. A mid-term card and an
 * end-term card for the same student and term are different documents with different
 * numbers; sharing a cache entry would serve one under the other's label.
 */
export function useReportCard(
  studentId: string | null,
  semesterId?: string,
  kind: ReportCardKind = 'endterm',
) {
  return useQuery({
    queryKey: ['reports', 'report-card', studentId, semesterId ?? null, kind],
    queryFn: () => fetchReportCard(studentId as string, semesterId, kind),
    enabled: Boolean(studentId),
  });
}

/** The signed-in student's own report card (student role → /me). */
export function useMyReportCard(semesterId?: string, kind: ReportCardKind = 'endterm') {
  return useQuery({
    queryKey: ['reports', 'report-card', 'me', semesterId ?? null, kind],
    queryFn: () => fetchMyReportCard(semesterId, kind),
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

// ── D45 Phase 9 — the four institutional reports of §53 ───────────────────────
// One hook each, all read-only. `enabled` lets the screen hold the request until the
// report is actually the one on screen: four reports behind four tabs would otherwise
// fire four college-wide queries every time the tab bar renders.
//
// No `staleTime`. These are the numbers somebody is about to act on — seat a student,
// call a programme about its attendance — and a cached figure that is five minutes
// behind the registration just made is worse than a spinner.

export function useNewVsReturning(academicYearId?: string, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'new-vs-returning', academicYearId ?? null],
    queryFn: () => fetchNewVsReturning(academicYearId),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useOvercapacity(semesterId?: string, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'overcapacity', semesterId ?? null],
    queryFn: () => fetchOvercapacity(semesterId),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCreditLoad(semesterId?: string, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'credit-load', semesterId ?? null],
    queryFn: () => fetchCreditLoad(semesterId),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useProgrammeAttendance(
  semesterId?: string,
  programId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['reports', 'programme-attendance', semesterId ?? null, programId ?? null],
    queryFn: () => fetchProgrammeAttendance(semesterId, programId),
    enabled,
    placeholderData: keepPreviousData,
  });
}
