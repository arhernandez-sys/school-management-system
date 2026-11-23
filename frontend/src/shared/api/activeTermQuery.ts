/**
 * Query options shared by every `GET /settings/active-term` hook, so a FAILED read heals
 * itself instead of sticking for the life of the tab.
 *
 * Why it used to stick (TanStack Query 5.101): a failed query with no data counts as stale,
 * but nothing triggers the refetch. The app turns `refetchOnWindowFocus` off globally
 * (`app/providers/queryClient.ts`), the hooks passed `retry: false`, and `YearProvider`
 * mounts ONCE above the router, so "refetch on mount" never fires again either. One
 * network blip or 5xx at login, or logging in before the admin had activated a session
 * (a 409), left `activeSemesterId` undefined until a hard reload.
 *
 * - `retry` is not set, so the app's default applies: 4xx (including the 409
 *   `no_active_semester` "not set up" signal) still fails at once, and 5xx or network
 *   errors get 2 retries.
 * - While the query is in ERROR it is re-checked on window focus and every 60 s, so a
 *   session the admin activates later shows up without a reload. Once it succeeds,
 *   both stop and the hook's normal `staleTime` applies.
 */
// Structural, so it fits any hook's `Query<TData, TError, …>` without generics.
type QueryLike = { state: { status: string } };

const isErrored = (query: QueryLike): boolean => query.state.status === 'error';

/** Re-check every minute while errored (one small GET per open tab). */
const ERROR_RECHECK_MS = 60_000;

export const ACTIVE_TERM_RECOVERY = {
  refetchOnWindowFocus: isErrored,
  refetchInterval: (query: QueryLike): number | false => (isErrored(query) ? ERROR_RECHECK_MS : false),
};
