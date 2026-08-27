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

/**
 * A date as `dd/mm/yyyy` — the format the school asked for (D39, Meeting #2 item 1).
 *
 * WHY THIS EXISTS: fifteen call sites each had their own `fmt` helper calling
 * `toLocaleDateString(undefined, …)`. `undefined` means the BROWSER'S locale, so the same
 * report card read `Aug 24, 2026` on one machine and `24.8.2026` on another — and never
 * the `dd/mm/yyyy` the school actually uses. A shared function is the only way a format
 * rule holds across a codebase; fifteen private helpers are fifteen places to drift.
 *
 * Assembled from `formatToParts` rather than a locale string, for the same reason
 * `schoolDateOf` is: a locale that happens to produce slashes today is not a guarantee.
 *
 * Accepts what the API actually sends — a `YYYY-MM-DD` date, a full ISO instant, or a
 * `Date`. Anything unparseable is returned as given rather than rendered as
 * `Invalid Date`: a screen showing a raw value is debuggable, one showing `NaN/NaN/NaN`
 * is not.
 *
 * NOTE: a plain `YYYY-MM-DD` is parsed as a CALENDAR date, not as UTC midnight. `new
 * Date('2026-08-24')` is midnight UTC, which is 18:00 on the 23rd in Belize — so passing
 * it through the timezone formatter below would print `23/08/2026` for every date-only
 * value in the system. Date-only strings are therefore split directly and never routed
 * through `Date` at all.
 */
export function formatSchoolDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    // Date-only (`YYYY-MM-DD`) — already a calendar date; no timezone reasoning applies.
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  }

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return schoolDateOf(d).split('-').reverse().join('/');
}

/**
 * A date as `dd/mm` — day-first, no year.
 *
 * For the handful of places that deliberately show a COMPACT date: the dashboard "next
 * due" chips, and the per-day column headers on the attendance summary. Those were
 * `Oct 15` and `Mon 15`; a full `15/10/2026` in a table header one column wide would
 * wrap, and the year is already established by the surrounding screen.
 *
 * Still day-first and slash-separated, so it reads as the same system as
 * `formatSchoolDate` rather than as a leftover. Use `formatSchoolDate` unless the space
 * genuinely does not exist — an undated `15/10` is ambiguous once a year rolls over.
 */
export function formatSchoolDayMonth(value: string | Date | null | undefined): string {
  const full = formatSchoolDate(value);
  // Only trim when it really is a `dd/mm/yyyy`; a passthrough of unparseable input must
  // survive intact rather than being sliced into nonsense.
  return /^\d{2}\/\d{2}\/\d{4}$/.test(full) ? full.slice(0, 5) : full;
}

/**
 * A date as `Mon 24/08/2026` — the weekday, then `dd/mm/yyyy`.
 *
 * Two screens genuinely need the weekday: the attendance register (a teacher checks they
 * are marking the right day) and the calendar. D39 changed the DATE half to `dd/mm/yyyy`
 * and left the weekday alone, because dropping it would have cost those screens
 * information to satisfy a formatting rule that was about digits, not about weekdays.
 *
 * `long` gives "Monday", `short` gives "Mon".
 */
export function formatSchoolDateWithWeekday(
  value: string | Date | null | undefined,
  weekday: 'long' | 'short' = 'short',
): string {
  const date = formatSchoolDate(value);
  if (!date) return '';

  // Date-only strings must not go through `new Date()` — see `formatSchoolDate`. Rebuild
  // the instant at MIDDAY so no timezone shift can move it off the intended weekday.
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00Z`)
      : value instanceof Date
        ? value
        : new Date(String(value));
  if (Number.isNaN(d.getTime())) return date;

  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIME_ZONE,
    weekday,
  }).format(d);
  return `${day} ${date}`;
}

/**
 * An instant as `dd/mm/yyyy HH:MM`, in the school's timezone.
 *
 * For the handful of places that show a TIME as well as a date — a submission deadline,
 * an audit stamp. Same 24-hour clock the rest of the system uses.
 */
export function formatSchoolDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${formatSchoolDate(d)} ${time}`;
}
