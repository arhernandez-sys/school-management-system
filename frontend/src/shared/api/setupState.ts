import { ApiError } from './client';

/**
 * Error CODES that mean "the school has no academic year / active session yet". That is a
 * SETUP state, not a failure: retrying can't fix it, only an administrator creating and
 * activating a year can. Screens show it as an empty state rather than the red
 * `ErrorState` with a Retry button.
 *
 * Decided by the server's `error.code`, never by status or message text: the same 404/409
 * statuses also carry real failures (`not_found`, `semester_not_found`, …), and those
 * must still look like errors.
 *
 * Where each one comes from (backend):
 *   - `no_active_semester` — GET /dashboard, GET /settings/active-term, report cards,
 *                            institutional reports.
 *   - `no_active_year`     — GET /settings/grading-scale, institutional reports.
 */
export const NO_ACADEMIC_YEAR_CODES: ReadonlySet<string> = new Set([
  'no_active_semester',
  'no_active_year',
]);

export const NO_ACADEMIC_YEAR_TITLE = 'No academic year yet';
export const NO_ACADEMIC_YEAR_MESSAGE =
  'No academic year has been created. Please contact administration.';

/** True when `error` is the server saying there is no academic year / active session. */
export function isNoAcademicYearError(error: unknown): boolean {
  return error instanceof ApiError && NO_ACADEMIC_YEAR_CODES.has(error.code);
}
