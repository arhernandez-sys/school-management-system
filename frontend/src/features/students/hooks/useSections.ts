/**
 * Subject-class options for the Students filters + the create form's enrolment picker.
 *
 * Reads the same `GET /classes` surface the Classes module uses, so the option list always
 * reconciles with that screen. Cached broadly (classes rarely change within a session) and
 * shared across the list filter and the form dialog.
 *
 * **D29** — this file used to export `useSectionOptions` / `gradeLevelsFrom`, built on the
 * premise that a student belongs to one homeroom and that "grade level" is a property of it.
 * Both are gone: the picker now selects MANY classes, and the students list filters on
 * `student_profiles.year_group` (the student's own level), which is not derivable from any
 * class. Year groups come from `useYearGroupOptions` below, which reads the students
 * directory instead.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type { StudentListItem } from '../types';

export interface ClassOption {
  id: string;
  name: string;
  /** The subject taught, when the class has one — shown to disambiguate "Math-1" vs "Math-2". */
  subject_name: string | null;
  grade_level: string;
}

interface ClassListRow {
  id: string;
  name: string;
  grade_level: string;
  subject: { id: string; name: string; code: string } | null;
}

/**
 * Every subject class in the active year, for a picker.
 *
 * `enabled` defers the fetch for consumers that mount before it is needed (a closed dialog).
 */
export function useClassOptions(enabled = true) {
  return useQuery({
    queryKey: ['classes', 'options'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const res = await api.get<Page<ClassListRow>>('/classes', {
        params: { page: 1, page_size: 200, sort: 'name' },
        signal,
      });
      return res.data.items.map<ClassOption>((c) => ({
        id: c.id,
        name: c.name,
        subject_name: c.subject?.name ?? null,
        grade_level: c.grade_level,
      }));
    },
  });
}

/**
 * The distinct year groups actually in use, for the students-list filter.
 *
 * Derived from the students directory rather than from a fixed enum or from class labels:
 * the school names its own levels, and the only authoritative list of the ones in use is
 * what the students themselves are set to. Reads one large page and distinct-ifies client
 * side — at single-school scale (~2,000 students, NFR-PERF-01) that is one cheap request,
 * and it avoids adding a `/students/year-groups` endpoint for a filter dropdown.
 */
export function useYearGroupOptions() {
  return useQuery({
    queryKey: ['students', 'year-groups'],
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const res = await api.get<Page<StudentListItem>>('/students', {
        params: { page: 1, page_size: 200, sort: 'year_group' },
        signal,
      });
      const groups = res.data.items
        .map((s) => s.year_group)
        .filter((g): g is string => Boolean(g));
      return [...new Set(groups)].sort((a, b) => a.localeCompare(b));
    },
  });
}
