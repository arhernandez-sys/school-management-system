/**
 * Timetable data hooks (D29, FR-SCH-03..05). Thin TanStack Query wrappers over the shared
 * axios client, like the Classes hooks — the Timetable endpoints are not orval-generated.
 *
 * The `['timetable']` key prefix is deliberately shallow: `useReplaceMeetings` and
 * `useEnrollStudents` (features/classes) invalidate the whole prefix, because retiming a
 * class or changing its roster changes the week of everyone attached to it and there is no
 * cheap way to know which cached weeks those are.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { TimetableView } from '../types';

export const timetableKeys = {
  all: ['timetable'] as const,
  me: (yearId: string | undefined) => [...timetableKeys.all, 'me', yearId ?? 'active'] as const,
  student: (studentId: string, yearId: string | undefined) =>
    [...timetableKeys.all, 'student', studentId, yearId ?? 'active'] as const,
};

/**
 * GET /timetable/me — the caller's own Mon–Fri week.
 *
 * Role-aware server-side: a student gets the classes they are enrolled in, a teacher the
 * classes they teach. Principal/secretary get an empty week rather than a 403 (they have no
 * personal timetable and the nav never offers them this screen).
 */
export function useMyTimetable(academicYearId?: string) {
  return useQuery({
    queryKey: timetableKeys.me(academicYearId),
    queryFn: async ({ signal }) => {
      const res = await api.get<TimetableView>('/timetable/me', {
        params: academicYearId ? { academic_year_id: academicYearId } : undefined,
        signal,
      });
      return res.data;
    },
  });
}

/**
 * GET /timetable/students/{id} — any student's week (P/S only).
 *
 * For the office to check a student's week before enrolling them into one more class,
 * which is the cheapest moment to catch a clash.
 */
export function useStudentTimetable(
  studentId: string | undefined,
  academicYearId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: timetableKeys.student(studentId ?? '', academicYearId),
    enabled: enabled && Boolean(studentId),
    queryFn: async ({ signal }) => {
      const res = await api.get<TimetableView>(`/timetable/students/${studentId}`, {
        params: academicYearId ? { academic_year_id: academicYearId } : undefined,
        signal,
      });
      return res.data;
    },
  });
}
