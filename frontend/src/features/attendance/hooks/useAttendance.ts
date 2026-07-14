/**
 * Attendance data hooks (TanStack Query). Own the query-key identity + cache
 * invalidation for the attendance feature; the transport lives in api/attendanceApi.
 *
 * Query keys include their inputs (section + date) so the cache stays correct as the
 * teacher switches sections/dates. The save mutation invalidates the affected register
 * and that section's summary so both screens reflect the new record immediately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAttendanceRegister,
  getAttendanceSections,
  getAttendanceSummary,
  getMyAttendance,
  putAttendanceRegister,
} from '../api/attendanceApi';

export const attendanceKeys = {
  all: ['attendance'] as const,
  sections: () => [...attendanceKeys.all, 'sections'] as const,
  register: (sectionId: string, date: string) =>
    [...attendanceKeys.all, 'register', sectionId, date] as const,
  summary: (sectionId: string) => [...attendanceKeys.all, 'summary', sectionId] as const,
  me: () => [...attendanceKeys.all, 'me'] as const,
};

/** Sections the caller may view/record (drives the section picker). */
export function useAttendanceSections() {
  return useQuery({
    queryKey: attendanceKeys.sections(),
    queryFn: ({ signal }) => getAttendanceSections(signal),
    staleTime: 5 * 60 * 1000, // sections rarely change within a demo session
  });
}

/** The daily register for a (section, date). Disabled until a section is chosen. */
export function useAttendanceRegister(sectionId: string | null, date: string) {
  return useQuery({
    queryKey: attendanceKeys.register(sectionId ?? '', date),
    queryFn: ({ signal }) => getAttendanceRegister({ section_id: sectionId!, date }, signal),
    enabled: Boolean(sectionId) && Boolean(date),
    placeholderData: (prev) => prev, // avoid a flash when switching date/section
  });
}

/** Per-section attendance summary over the seeded window. */
export function useAttendanceSummary(sectionId: string | null) {
  return useQuery({
    queryKey: attendanceKeys.summary(sectionId ?? ''),
    queryFn: ({ signal }) => getAttendanceSummary(sectionId!, signal),
    enabled: Boolean(sectionId),
  });
}

/** The signed-in student's own attendance (self-scoped). */
export function useMyAttendance() {
  return useQuery({
    queryKey: attendanceKeys.me(),
    queryFn: ({ signal }) => getMyAttendance(signal),
  });
}

/** Save (bulk upsert) the register; invalidates that register + the section summary. */
export function useSaveAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: putAttendanceRegister,
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: attendanceKeys.register(variables.section_id, variables.date),
      });
      void qc.invalidateQueries({ queryKey: attendanceKeys.summary(variables.section_id) });
    },
  });
}
