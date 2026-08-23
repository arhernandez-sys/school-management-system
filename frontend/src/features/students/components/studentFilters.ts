/**
 * The students directory's filter STATE — the value object, its empty form, and how many
 * of it are active (D33).
 *
 * Split out of `StudentFiltersDialog.tsx` so that file exports only a component: mixing
 * values and components in one module breaks React Fast Refresh, which is what
 * `react-refresh/only-export-components` is warning about. It is also the right seam —
 * `StudentsListPage` needs the shape and the counter without needing the dialog.
 */
import type { StudentStatus } from '@shared/types/enums';

/**
 * Every filter the students directory accepts, as one value object.
 *
 * `search` is deliberately NOT in here. It lives in the toolbar because it is typed
 * continuously and debounced — putting it behind an Apply button would make the one
 * control people use constantly the slowest one to use.
 */
export interface StudentFilterValues {
  yearId: string | undefined;
  status: StudentStatus | '';
  yearOfStudy: string;
  gender: string;
  religion: string;
  programId: string;
  offeringId: string;
}

export const EMPTY_STUDENT_FILTERS: StudentFilterValues = {
  yearId: undefined,
  status: '',
  yearOfStudy: '',
  gender: '',
  religion: '',
  programId: '',
  offeringId: '',
};

/** How many filters are narrowing the list. Drives the toolbar button's badge. */
export function activeStudentFilterCount(
  v: StudentFilterValues,
  { activeYearId }: { activeYearId?: string } = {},
): number {
  let n = 0;
  // The academic year is always SET — it defaults to the active one — so it only counts
  // as a filter when it has been moved off that default. Counting it unconditionally
  // would badge the button "1" on a directory nobody has filtered.
  if (v.yearId && v.yearId !== activeYearId) n += 1;
  if (v.status) n += 1;
  if (v.yearOfStudy) n += 1;
  if (v.gender) n += 1;
  if (v.religion) n += 1;
  if (v.programId) n += 1;
  if (v.offeringId) n += 1;
  return n;
}
