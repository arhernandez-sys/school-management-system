/**
 * Offering options for the Students filters + the create form's enrolment picker.
 *
 * Reads the same `GET /offerings` surface the Offerings module uses, so the option list
 * always reconciles with that screen. Cached broadly (offerings rarely change within a
 * session) and shared across the list filter and the form dialog.
 *
 * **History of this file, because both removals are load-bearing.**
 *
 * D29 deleted `useSectionOptions` / `gradeLevelsFrom`, which assumed a student belongs to
 * one homeroom and that "grade level" is a property of it. The picker began selecting MANY
 * classes.
 *
 * **D31 deleted `useYearGroupOptions`.** It fetched a 200-student page and distinct-ified
 * `year_group` client-side, on the reasoning that "the school names its own levels, and the
 * only authoritative list of the ones in use is what the students are set to." That is no
 * longer true: `student_profiles.year_of_study` is `enum('First','Second')` server-side, so
 * the authoritative list is two constants. A request that read 200 student records to
 * rediscover them was answering a question the schema now answers — and it was reading a
 * column that had been renamed out from under it, so the filter was silently empty.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type { OfferingListItem } from '@features/offerings/types';
import type { YearOfStudy } from '../types';

/** The two BAJC years, in progression order. Mirrors the server-side enum exactly. */
export const YEAR_OF_STUDY_OPTIONS: YearOfStudy[] = ['First', 'Second'];

export interface OfferingOption {
  id: string;
  /** The server-computed label — "MATH1110-01 · Semester 1". Print it, do not rebuild it. */
  label: string;
  /** The course name, shown beneath the label so a picker is readable. */
  course_name: string | null;
  /** Which term it runs in — the field that distinguishes two otherwise identical rows. */
  semester_name: string | null;
}

/**
 * Every offering in the selected scope, for a picker.
 *
 * `enabled` defers the fetch for consumers that mount before it is needed (a closed dialog).
 */
export function useOfferingOptions(enabled = true) {
  return useQuery({
    queryKey: ['offerings', 'options'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const res = await api.get<Page<OfferingListItem>>('/offerings', {
        params: { page: 1, page_size: 200, sort: 'label' },
        signal,
      });
      return res.data.items.map<OfferingOption>((o) => ({
        id: o.id,
        label: o.label,
        course_name: o.course?.name ?? null,
        semester_name: o.semester?.name ?? null,
      }));
    },
  });
}
