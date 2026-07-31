/**
 * School-local calendar dates — the frontend half of the backend's `school_today()`.
 *
 * WHY THIS EXISTS: several screens previously imported `DEMO_TODAY` (a fixed
 * '2025-10-15') from the demo dataset to mean "today". That is correct in
 * `npm run demo` and badly wrong against a real backend — the attendance register
 * opened on a date months in the past, and its date picker capped `max` there, so a
 * teacher could not select the actual current day at all.
 *
 * WHY NOT just `new Date().toISOString().slice(0, 10)`: that is the **UTC** date.
 * Belize is UTC-6 with no DST, so from 18:00 local onward the UTC date is already
 * tomorrow. The backend validates attendance dates against `school_today()` in
 * `America/Belize` and rejects a future date with `future_date_not_allowed` — so a
 * teacher marking the register at 19:00 would have had the UI offer a date the API
 * then refused. Resolving the date in the school's timezone keeps both halves in
 * agreement regardless of how the user's device clock is set (a phone on UTC, or a
 * laptop that travelled).
 *
 * Mirrors `backend/app/core/timeutil.py`: anything a human calls "today" or "a date"
 * is school-local; anything that is an instant stays UTC.
 */

const SCHOOL_TIME_ZONE = 'America/Belize';

// Built once — constructing an Intl.DateTimeFormat is comparatively expensive and
// these are called during render.
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHOOL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today's date at the school, as `YYYY-MM-DD`.
 *
 * Assembled from `formatToParts` rather than trusting a locale's format string, so
 * the output is guaranteed ISO-ordered and zero-padded — the shape both
 * `<input type="date">` and the API expect.
 */
export function schoolToday(): string {
  return schoolDateOf(new Date());
}

/** The school-local `YYYY-MM-DD` for any instant. */
export function schoolDateOf(instant: Date): string {
  const parts = dateParts.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
