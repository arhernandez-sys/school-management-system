/**
 * Calendar date + presentation helpers. Everything works on `YYYY-MM-DD` strings and
 * uses UTC-constructed Dates so a day never drifts across a timezone boundary (the app
 * has no date library). Weeks are Sunday-first.
 */
import type { StatusKind } from '@shared/components';
import type { CalendarEvent, EventCategory, EventVisibility } from './types';

export interface DayCell {
  ymd: string;
  day: number;
  inMonth: boolean;
}

const MS_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` into a UTC Date at midnight. */
export function parseYMD(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** Format a UTC Date back to `YYYY-MM-DD`. */
export function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayYMD(): string {
  return toYMD(new Date());
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(year: number, monthIndex: number): string {
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/** Shift a {year, monthIndex} cursor by whole months, normalising overflow. */
export function addMonths(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; monthIndex: number } {
  const total = year * 12 + monthIndex + delta;
  return { year: Math.floor(total / 12), monthIndex: ((total % 12) + 12) % 12 };
}

/**
 * The 6×7 grid of days covering a month, padded with the tail of the previous month
 * and the head of the next so every week row is full (Sunday-first).
 */
export function monthMatrix(year: number, monthIndex: number): DayCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const startOffset = first.getUTCDay(); // 0 = Sunday
  const gridStart = new Date(first.getTime() - startOffset * MS_DAY);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart.getTime() + i * MS_DAY);
    cells.push({
      ymd: toYMD(d),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === monthIndex && d.getUTCFullYear() === year,
    });
  }
  return cells;
}

/** Does an event's inclusive span cover the given day? */
export function eventCoversDay(e: CalendarEvent, ymd: string): boolean {
  const end = e.end_date ?? e.start_date;
  return e.start_date <= ymd && ymd <= end;
}

/** Events covering a day, timed-first then all-day, each in chronological order. */
export function eventsOnDay(events: CalendarEvent[], ymd: string): CalendarEvent[] {
  return events
    .filter((e) => eventCoversDay(e, ymd))
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? 1 : -1;
      return (a.start_time ?? '').localeCompare(b.start_time ?? '');
    });
}

/** Upcoming events on/after a reference day, soonest first. */
export function upcomingEvents(
  events: CalendarEvent[],
  fromYMD: string,
  limit = 6,
): CalendarEvent[] {
  return events
    .filter((e) => (e.end_date ?? e.start_date) >= fromYMD)
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        (a.start_time ?? '').localeCompare(b.start_time ?? ''),
    )
    .slice(0, limit);
}

/** "9:00 AM" from "09:00". */
export function formatTime(hhmm: string | null): string {
  if (!hhmm) return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

/** "Wed, Oct 15, 2025". */
export function formatDateLong(ymd: string): string {
  return parseYMD(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A short human range for an event ("Oct 20 · 5:00 PM – 6:30 PM", "Oct 20 – Oct 24"). */
export function formatEventWhen(e: CalendarEvent): string {
  const start = formatDateLong(e.start_date);
  if (e.end_date && e.end_date !== e.start_date) {
    return `${start} – ${formatDateLong(e.end_date)}`;
  }
  if (!e.all_day && e.start_time) {
    const times = e.end_time
      ? `${formatTime(e.start_time)} – ${formatTime(e.end_time)}`
      : formatTime(e.start_time);
    return `${start} · ${times}`;
  }
  return `${start} · All day`;
}

export interface CategoryMeta {
  label: string;
  kind: StatusKind;
  /** MUI palette family for grid chips / accents. */
  color: 'error' | 'warning' | 'info' | 'success' | 'secondary';
}

export const CATEGORY_META: Record<EventCategory, CategoryMeta> = {
  holiday: { label: 'Holiday', kind: 'error', color: 'error' },
  exam: { label: 'Exam', kind: 'warning', color: 'warning' },
  meeting: { label: 'Meeting', kind: 'info', color: 'info' },
  activity: { label: 'Activity', kind: 'success', color: 'success' },
  other: { label: 'Other', kind: 'neutral', color: 'secondary' },
};

export const CATEGORY_OPTIONS: EventCategory[] = [
  'holiday',
  'exam',
  'meeting',
  'activity',
  'other',
];

export interface VisibilityMeta {
  /** Short chip label. */
  label: string;
  /** Longer description used in the form/help. */
  description: string;
}

export const VISIBILITY_META: Record<EventVisibility, VisibilityMeta> = {
  global: { label: 'Everyone', description: 'Visible to all staff and students' },
  internal: { label: 'Staff only', description: 'Visible to teachers, principal and secretary — hidden from students' },
};

export const VISIBILITY_OPTIONS: EventVisibility[] = ['global', 'internal'];
