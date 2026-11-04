/**
 * Attendance data hooks (TanStack Query). Own the query-key identity + cache
 * invalidation for the attendance feature; the transport lives in api/attendanceApi.
 *
 * Query keys include their inputs (offering + date) so the cache stays correct as the
 * lecturer switches offerings/dates. The save mutation invalidates the affected register
 * and that offering's summary so both screens reflect the new record immediately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAttendanceAlerts,
  getAttendanceRegister,
  getAttendanceOfferings,
  getAttendanceSummary,
  getMyAttendance,
  putAttendanceRegister,
} from '../api/attendanceApi';

export const attendanceKeys = {
  all: ['attendance'] as const,
  offerings: (academicYearId?: string | null) =>
    [...attendanceKeys.all, 'offerings', academicYearId ?? null] as const,
  register: (offeringId: string, date: string) =>
    [...attendanceKeys.all, 'register', offeringId, date] as const,
  summary: (offeringId: string) => [...attendanceKeys.all, 'summary', offeringId] as const,
  // D44 — keyed on the YEAR, so switching the year filter refetches and switching
  // back is served from cache.
  alerts: (academicYearId?: string | null) =>
    [...attendanceKeys.all, 'alerts', academicYearId ?? null] as const,
  // Both period ids are in the key so the global switcher refetches rather than
  // re-serving the previous period.
  me: (academicYearId?: string | null, semesterId?: string | null) =>
    [...attendanceKeys.all, 'me', academicYearId ?? null, semesterId ?? null] as const,
};

/** Offerings the caller may view/record (drives the picker), year-scoped. */
export function useAttendanceOfferings(academicYearId?: string) {
  return useQuery({
    queryKey: attendanceKeys.offerings(academicYearId),
    queryFn: ({ signal }) => getAttendanceOfferings(academicYearId, signal),
    staleTime: 5 * 60 * 1000, // offerings rarely change within a demo session
  });
}

/** The daily register for an (offering, date). Disabled until an offering is chosen. */
export function useAttendanceRegister(offeringId: string | null, date: string) {
  return useQuery({
    queryKey: attendanceKeys.register(offeringId ?? '', date),
    queryFn: ({ signal }) => getAttendanceRegister({ offering_id: offeringId!, date }, signal),
    enabled: Boolean(offeringId) && Boolean(date),
    placeholderData: (prev) => prev, // avoid a flash when switching date/offering
  });
}

/** Per-offering attendance summary over the seeded window. */
export function useAttendanceSummary(offeringId: string | null) {
  return useQuery({
    queryKey: attendanceKeys.summary(offeringId ?? ''),
    queryFn: ({ signal }) => getAttendanceSummary(offeringId!, signal),
    enabled: Boolean(offeringId),
  });
}

/** The signed-in student's own attendance (self-scoped), year·semester-scoped. */
export function useMyAttendance(academicYearId?: string, semesterId?: string) {
  return useQuery({
    queryKey: attendanceKeys.me(academicYearId, semesterId),
    queryFn: ({ signal }) => getMyAttendance(academicYearId, semesterId, signal),
  });
}

/** Save (bulk upsert) the register; invalidates that register + the offering summary. */
/**
 * D44 — classes and students below the attendance floor.
 *
 * Same `staleTime` as the offerings picker: an alert list is a standing summary, not a
 * live feed, and refetching it on every focus change would be noise.
 */
export function useAttendanceAlerts(academicYearId?: string | null) {
  return useQuery({
    queryKey: attendanceKeys.alerts(academicYearId),
    queryFn: ({ signal }) => getAttendanceAlerts(academicYearId ?? undefined, undefined, signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: putAttendanceRegister,
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: attendanceKeys.register(variables.offering_id, variables.date),
      });
      void qc.invalidateQueries({ queryKey: attendanceKeys.summary(variables.offering_id) });
    },
  });
}
