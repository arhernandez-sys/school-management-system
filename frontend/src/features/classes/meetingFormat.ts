/**
 * Meeting/day formatting — the ONE place the frontend turns a `ClassMeeting` into text.
 *
 * Shared by the classes list, the Schedule tab, and the timetable views so "Mon 08:00–09:30"
 * reads identically everywhere. The backend sends `day_name` on timetable entries and a
 * pre-rendered `message` on conflicts precisely so those two never need re-deriving here;
 * this module covers the places that only receive the raw meeting.
 */
import type { ClassMeeting, ClassMeetingInput, DayOfWeek } from './types';

/** ISO weekday → short label. Mon–Fri only; the API cannot express a weekend. */
export const DAY_SHORT: Record<DayOfWeek, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
};

/** ISO weekday → full label, for column headers and the day-grouped mobile list. */
export const DAY_LONG: Record<DayOfWeek, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
};

/** Mon…Fri in order — the canonical iteration order for a week view. */
export const WEEKDAYS: DayOfWeek[] = [1, 2, 3, 4, 5];

/**
 * "08:00:00" → "08:00". The API serves `HH:MM:SS`; seconds are always zero for a
 * timetable slot and only add noise on screen.
 */
export function formatTime(value: string): string {
  return value.slice(0, 5);
}

/** "08:00–09:30" (en dash, matching the server-rendered conflict messages). */
export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** "Mon 08:00–09:30" — one meeting, without its room. */
export function formatMeeting(m: ClassMeeting): string {
  return `${DAY_SHORT[m.day_of_week]} ${formatTimeRange(m.start_time, m.end_time)}`;
}

/**
 * "Mon 08:00–09:30 · Wed 10:00–11:00" — a class's whole week on one line, for a table cell.
 * Returns `null` for an unscheduled class so callers can render their own em-dash or
 * "Not scheduled" badge rather than an empty string.
 */
export function summarizeMeetings(meetings: ClassMeeting[]): string | null {
  if (meetings.length === 0) return null;
  return meetings.map(formatMeeting).join(' · ');
}

/**
 * The distinct rooms a class uses, in first-seen order. Usually one; a class that moves
 * between a classroom and a lab legitimately has two, and showing only the first would be
 * wrong in exactly the case the reader cares about.
 */
export function roomsOf(meetings: ClassMeeting[]): string[] {
  return [...new Set(meetings.map((m) => m.room?.trim()).filter((r): r is string => Boolean(r)))];
}

/**
 * `end <= start` — the ONE meeting rule checkable without the server (the API 422s on it).
 *
 * Every other rule is cross-class (teacher double-booked, room double-booked, student clash)
 * and only the server can see the other classes, so it reports those as warnings after the
 * write rather than as validation. Lives here rather than beside the editor component so the
 * editor file exports only a component (react-refresh).
 */
export function meetingRowInvalid(m: ClassMeetingInput): boolean {
  return Boolean(m.start_time && m.end_time && m.end_time <= m.start_time);
}
