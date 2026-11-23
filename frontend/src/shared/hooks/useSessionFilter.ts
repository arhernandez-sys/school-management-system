/**
 * useSessionFilter — the session (semester) chosen beside a module's `<YearSelect>`.
 *
 * A year carries several sessions, active and inactive alike, so a year on its own mixed
 * them together. The session is now chosen explicitly and the lists are scoped to it.
 *
 * Resolution, in order: the `?session=` URL value if it names a session of the selected
 * year, else the ACTIVE session if it belongs to that year, else that year's most recent
 * session. There is no "all sessions": one session is always selected, so a past year is
 * browsed one session at a time.
 *
 * `isActive` is the read-only switch. Only the active session's assessments and grades can
 * change; the server enforces the same rule with a 409 `session_inactive`.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useListAcademicYearsApiV1SettingsAcademicYearsGet } from '@shared/api/generated/settings/settings';

export interface SessionOption {
  id: string;
  name: string;
  isActive: boolean;
  sequence: number;
}

export interface UseSessionFilterResult {
  /** The resolved session id (undefined while loading or when the year has none). */
  sessionId: string | undefined;
  setSessionId: (id: string) => void;
  /** Forget the chosen session (back to the default / an "all" view where offered). */
  clearSessionId: () => void;
  /** Whether the session came from the URL, i.e. was picked rather than defaulted. */
  isExplicit: boolean;
  /** The selected year's sessions, in calendar order. */
  sessions: SessionOption[];
  activeSessionId: string | undefined;
  /** Whether the selected session is the active one (i.e. writable). */
  isActive: boolean;
  isLoading: boolean;
}

function useAcademicYears() {
  // Same query key as `useYearFilter`, so the two share one cached request.
  return useListAcademicYearsApiV1SettingsAcademicYearsGet({
    query: { staleTime: 5 * 60 * 1000 },
  });
}

export function useSessionFilter(yearId: string | undefined): UseSessionFilterResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useAcademicYears();

  const allSessions = useMemo(
    () =>
      (query.data?.items ?? []).flatMap((y) =>
        y.semesters.map((s) => ({
          id: s.id,
          name: s.name,
          isActive: s.is_active,
          sequence: s.sequence,
          yearId: y.id,
        })),
      ),
    [query.data],
  );

  const sessions = useMemo<SessionOption[]>(
    () =>
      allSessions
        .filter((s) => s.yearId === yearId)
        .sort((a, b) => a.sequence - b.sequence)
        .map(({ id, name, isActive, sequence }) => ({ id, name, isActive, sequence })),
    [allSessions, yearId],
  );

  const activeSessionId = allSessions.find((s) => s.isActive)?.id;
  const urlSession = searchParams.get('session') ?? undefined;
  const sessionId = sessions.some((s) => s.id === urlSession)
    ? urlSession
    : sessions.some((s) => s.id === activeSessionId)
      ? activeSessionId
      : sessions[sessions.length - 1]?.id;

  const setSessionId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('session', id);
    setSearchParams(next, { replace: true });
  };
  const clearSessionId = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('session');
    setSearchParams(next, { replace: true });
  };

  return {
    sessionId,
    setSessionId,
    clearSessionId,
    isExplicit: sessions.some((s) => s.id === urlSession),
    sessions,
    activeSessionId,
    isActive: sessionId !== undefined && sessionId === activeSessionId,
    isLoading: query.isLoading,
  };
}

/**
 * Whether a given session id is the active one. For screens that reach a single record
 * (an offering's gradebook) rather than a filtered list. `undefined` while loading.
 */
export function useIsSessionActive(sessionId: string | null | undefined): boolean | undefined {
  const query = useAcademicYears();
  if (!sessionId || !query.data) return undefined;
  for (const y of query.data.items) {
    const s = y.semesters.find((x) => x.id === sessionId);
    if (s) return s.is_active;
  }
  return undefined;
}
