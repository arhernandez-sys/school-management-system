import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useActiveTerm } from '@features/settings/hooks/useSettings';

/**
 * Student-facing GLOBAL academic-year selection.
 *
 * Staff scope data per-module via `useYearFilter` (URL `?year=`). A student instead
 * gets a single top-bar switcher that re-scopes their whole view (My Grades, My
 * Classes, My Attendance). This context holds that selection; the switcher writes it
 * and the student screens read `selectedYearId` and pass it as `academic_year_id`.
 *
 * The list of years is the years the student was actually enrolled in
 * (`GET /students/me/years`); it defaults to the active year.
 */
export interface StudentYear {
  id: string;
  name: string;
  status: string;
}

interface YearContextValue {
  /** Selected year (defaults to the active year until the user changes it). */
  selectedYearId: string | undefined;
  setSelectedYearId: (id: string) => void;
  /** Years the student was enrolled in, newest first (empty for non-students). */
  years: StudentYear[];
  activeYearId: string | undefined;
  /** Active-semester name (e.g. "Semester 1"), for the switcher label. */
  activeSemesterName: string | undefined;
}

const YearContext = createContext<YearContextValue | undefined>(undefined);

export function YearProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const activeTerm = useActiveTerm();

  const yearsQuery = useQuery({
    queryKey: ['student-years', user?.id ?? null],
    enabled: isStudent,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: StudentYear[] }>('/students/me/years', { signal });
      return res.data.items;
    },
  });

  const years = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  const activeYearId =
    activeTerm.data?.academic_year?.id ?? years.find((y) => y.status === 'active')?.id;
  const activeSemesterName = activeTerm.data?.semester?.name;

  const [selected, setSelected] = useState<string | undefined>(undefined);
  // Resolve to a valid year: an explicit pick, else the active year, else newest.
  const selectedYearId =
    (selected && years.some((y) => y.id === selected) ? selected : undefined) ??
    activeYearId ??
    years[0]?.id;

  const value = useMemo<YearContextValue>(
    () => ({ selectedYearId, setSelectedYearId: setSelected, years, activeYearId, activeSemesterName }),
    [selectedYearId, years, activeYearId, activeSemesterName],
  );

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
}

export function useSelectedYear(): YearContextValue {
  const ctx = useContext(YearContext);
  if (!ctx) throw new Error('useSelectedYear must be used within YearProvider');
  return ctx;
}
