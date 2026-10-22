import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useAcademicYears, useActiveTerm } from '@features/settings/hooks/useSettings';

/**
 * Student-facing GLOBAL academic-period selection.
 *
 * Staff scope data per-module via `useYearFilter` (URL `?year=`). A student instead gets
 * a single top-bar switcher that re-scopes their whole view. This context holds that
 * selection; the switcher writes it and the student screens read it.
 *
 * ── It picks a YEAR **and** a SEMESTER (changed 2026-07-29) ────────────────────────
 * It used to hold a year only, while the switcher's label appended "· Semester 1" read
 * from the school's *active* term. So the control announced a semester it could not
 * select, and "My Assessments" listed the whole year under a heading naming one term.
 * Now every option is a real year·semester pair and screens scope by whichever is
 * meaningful for their data:
 *
 *   - semester-keyed  → assessments, grades, attendance  (`semester_id`)
 *   - year-keyed      → classes/sections, profile enrollment (`academic_year_id`)
 *
 * ── Where the options come from ────────────────────────────────────────────────────
 * Two cached reads, joined on the client:
 *   - `GET /students/me/years`      — the years this student was actually ENROLLED in.
 *                                     This is the list that stops them browsing years
 *                                     they never attended, so it stays the outer join.
 *   - `GET /settings/academic-years` — each year's semesters. Readable by every
 *                                     authenticated role as of 2026-07-29, so this
 *                                     needs no new endpoint. Same client-side join
 *                                     `features/reports/components/TermPicker.tsx`
 *                                     does, for the same reason: semester `name` is not
 *                                     unique — every year has a "Semester 1" — so an id
 *                                     is the only safe identity and the label must
 *                                     carry the year.
 */
export interface StudentYear {
  id: string;
  name: string;
  status: string;
}

/** One selectable year·semester pair — the unit the top-bar switcher lists. */
export interface StudentPeriod {
  yearId: string;
  yearName: string;
  yearStatus: string;
  semesterId: string;
  semesterName: string;
  sequence: number;
  isActiveYear: boolean;
  isActiveSemester: boolean;
  /** Display label, e.g. "2025-2026 · Semester 1". */
  label: string;
}

interface YearContextValue {
  /** Selected year (defaults to the active year until the user changes it). */
  selectedYearId: string | undefined;
  /**
   * Selected semester WITHIN {@link selectedYearId}. `undefined` for non-students, and
   * while the two reads are in flight. A screen that gets `undefined` should fall back
   * to year-wide scoping rather than sending nothing at all.
   */
  selectedSemesterId: string | undefined;
  /** The resolved selected pair, for labelling ("…for 2024-2025 · Semester 2"). */
  selectedPeriod: StudentPeriod | undefined;
  /** Pick a year·semester pair. Both ids must come from the same {@link periods} row. */
  setSelectedPeriod: (yearId: string, semesterId: string) => void;
  /**
   * Pick a year, keeping the semester coherent: resolves to that year's active
   * semester, else its first. Kept so callers that only care about years stay simple.
   */
  setSelectedYearId: (id: string) => void;
  /** Selectable pairs — newest year first, semesters ascending. `[]` for non-students. */
  periods: StudentPeriod[];
  /** Years the student was enrolled in, newest first (empty for non-students). */
  years: StudentYear[];
  activeYearId: string | undefined;
  /** Active-semester name (e.g. "Semester 1"), for the switcher label. */
  activeSemesterName: string | undefined;
  /**
   * Active-semester **id** — required by every assessment write (`semester_id`).
   *
   * Exposed here because this provider already reads `GET /settings/active-term` for
   * all authenticated roles, so consumers get the real id with no extra request.
   * Before this, the two authoring screens sent `DEMO_IDS.activeSemesterId` — a
   * hardcoded id from the demo dataset — so creating an assessment could not work
   * against a real database. `undefined` while the term loads, or when the school has
   * no active semester (the API answers 409 `no_active_semester`); callers must treat
   * it as "cannot author yet" rather than substituting a fallback.
   *
   * ⚠️ NOT the same thing as {@link selectedSemesterId}. This is the school's current
   * term and belongs to WRITE paths; the selected semester is what the student is
   * looking at and belongs to READ paths. A staff screen authoring an assessment must
   * keep using this one.
   */
  activeSemesterId: string | undefined;
}

const YearContext = createContext<YearContextValue | undefined>(undefined);

/**
 * Where the student's pick is remembered across reloads.
 *
 * Staff's `?year=` survives a refresh because it lives in the URL. This context sits
 * ABOVE the router (AppProviders) and applies to every route, so it cannot be a single
 * URL param — but a global control that silently resets to the active term on every
 * reload reads as broken. `sessionStorage`, not `localStorage`: the scope is one tab's
 * browsing session, and it must not outlive a logout on a shared machine.
 */
const STORAGE_KEY = 'sis.student.period';

interface StoredPeriod {
  yearId: string;
  semesterId: string;
}

function readStoredPeriod(): StoredPeriod | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredPeriod).yearId === 'string' &&
      typeof (parsed as StoredPeriod).semesterId === 'string'
    ) {
      return parsed as StoredPeriod;
    }
  } catch {
    // Private-mode / disabled storage / hand-edited value: fall back to the active term.
  }
  return undefined;
}

function writeStoredPeriod(value: StoredPeriod): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Persistence is a convenience; losing it must never break the switcher.
  }
}

export function YearProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const isStudent = user?.role === 'student';
  // YearProvider mounts above the route guards, so it renders while AuthProvider is
  // still bootstrapping. Hold both reads until the session exists — otherwise they
  // fire with no access token and 401 on every hard reload.
  const isAuthed = status === 'authenticated';
  const activeTerm = useActiveTerm({ enabled: isAuthed });
  // Only students need the semester calendar; staff have their own per-module pickers.
  const calendar = useAcademicYears({ enabled: isStudent && isAuthed });

  const yearsQuery = useQuery({
    queryKey: ['student-years', user?.id ?? null],
    enabled: isStudent && isAuthed,
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
  const activeSemesterId = activeTerm.data?.semester?.id;

  /**
   * The enrolled years joined to the calendar's semesters. A year the student was
   * enrolled in but that the calendar has no semesters for is dropped: an option with
   * no semester could not scope anything, so offering it would be a dead entry.
   */
  const periods = useMemo<StudentPeriod[]>(() => {
    const semestersByYear = new Map(
      (calendar.data?.items ?? []).map((y) => [y.id, y.semesters ?? []]),
    );
    return years.flatMap((year) =>
      [...(semestersByYear.get(year.id) ?? [])]
        .sort((a, b) => a.sequence - b.sequence)
        .map<StudentPeriod>((sem) => ({
          yearId: year.id,
          yearName: year.name,
          yearStatus: year.status,
          semesterId: sem.id,
          semesterName: sem.name,
          sequence: sem.sequence,
          isActiveYear: year.id === activeYearId,
          isActiveSemester: sem.id === activeSemesterId,
          label: `${year.name} · ${sem.name}`,
        })),
    );
    // `years` is already newest-first from the API, and flatMap preserves that order.
  }, [years, calendar.data, activeYearId, activeSemesterId]);

  const [picked, setPicked] = useState<StoredPeriod | undefined>(readStoredPeriod);

  /**
   * Resolve to a pair that actually exists: an explicit/restored pick → the active
   * year·semester → the active year's first semester → the newest year's first.
   * Never returns a stale or cross-year combination.
   */
  const selectedPeriod = useMemo<StudentPeriod | undefined>(() => {
    if (periods.length === 0) return undefined;
    const exact = picked
      ? periods.find((p) => p.yearId === picked.yearId && p.semesterId === picked.semesterId)
      : undefined;
    return (
      exact ??
      periods.find((p) => p.isActiveYear && p.isActiveSemester) ??
      periods.find((p) => p.isActiveYear) ??
      periods[0]
    );
  }, [periods, picked]);

  // Year selection must keep working before the calendar loads (and for the brief
  // window where a student has enrolled years but no semesters resolved yet), so the
  // year falls back to the old cascade rather than depending on `periods`.
  const selectedYearId =
    selectedPeriod?.yearId ??
    (picked && years.some((y) => y.id === picked.yearId) ? picked.yearId : undefined) ??
    activeYearId ??
    years[0]?.id;

  const setSelectedPeriod = useCallback((yearId: string, semesterId: string) => {
    const next = { yearId, semesterId };
    setPicked(next);
    writeStoredPeriod(next);
  }, []);

  const setSelectedYearId = useCallback(
    (id: string) => {
      // Keep the pair coherent: a semester id from the previous year would resolve to
      // nothing (or, worse, be sent alongside the new year and empty every screen).
      const inYear = periods.filter((p) => p.yearId === id);
      const target = inYear.find((p) => p.isActiveSemester) ?? inYear[0];
      const next = { yearId: id, semesterId: target?.semesterId ?? '' };
      setPicked(next);
      if (target) writeStoredPeriod(next);
    },
    [periods],
  );

  const value = useMemo<YearContextValue>(
    () => ({
      selectedYearId,
      selectedSemesterId: selectedPeriod?.semesterId,
      selectedPeriod,
      setSelectedPeriod,
      setSelectedYearId,
      periods,
      years,
      activeYearId,
      activeSemesterName,
      activeSemesterId,
    }),
    [
      selectedYearId,
      selectedPeriod,
      setSelectedPeriod,
      setSelectedYearId,
      periods,
      years,
      activeYearId,
      activeSemesterName,
      activeSemesterId,
    ],
  );

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
}

export function useSelectedYear(): YearContextValue {
  const ctx = useContext(YearContext);
  if (!ctx) throw new Error('useSelectedYear must be used within YearProvider');
  return ctx;
}
