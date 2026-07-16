/**
 * useYearFilter — per-module academic-year selection.
 *
 * The demo has no global "selected year"; instead each list module owns its own year
 * choice, shown as a `<YearSelect>` beside the search bar. The chosen year is persisted
 * in the URL (`?year=`) so it survives refresh/back, and defaults to the active year.
 *
 * The resolved `yearId` is threaded into that module's list query (as
 * `academic_year_id`) and into the MSW handlers, which scope the rows to that year.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useListAcademicYearsApiV1SettingsAcademicYearsGet } from '@shared/api/generated/settings/settings';

export interface YearOption {
  id: string;
  name: string;
  status: string;
}

export interface UseYearFilterResult {
  /** The resolved, always-valid selected year id (undefined only while loading). */
  yearId: string | undefined;
  /** Change the selected year (writes `?year=` to the URL). */
  setYearId: (id: string) => void;
  /** Years available to pick from, newest first. */
  years: YearOption[];
  isLoading: boolean;
  activeYearId: string | undefined;
}

export function useYearFilter(): UseYearFilterResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useListAcademicYearsApiV1SettingsAcademicYearsGet({
    query: { staleTime: 5 * 60 * 1000 },
  });

  const years = useMemo<YearOption[]>(
    () =>
      (query.data?.items ?? [])
        .map((y) => ({ id: y.id, name: y.name, status: y.status as string }))
        .sort((a, b) => b.name.localeCompare(a.name)),
    [query.data],
  );

  const activeYearId = years.find((y) => y.status === 'active')?.id;
  const urlYear = searchParams.get('year') ?? undefined;
  // Resolve to a valid year: the URL value if it names a real year, else the active
  // year, else the most recent. Never returns a stale/unknown id.
  const yearId = years.some((y) => y.id === urlYear) ? urlYear : (activeYearId ?? years[0]?.id);

  const setYearId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('year', id);
    // Changing the year resets pagination-by-URL consumers implicitly (new query key).
    setSearchParams(next, { replace: true });
  };

  return { yearId, setYearId, years, isLoading: query.isLoading, activeYearId };
}
