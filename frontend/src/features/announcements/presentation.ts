/**
 * Small presentation helpers shared across the Announcements screens — audience
 * labelling and locale-stable date/time formatting. Kept out of components so the
 * feed, detail, and form render labels consistently (design-system §5 #12: the text
 * label always carries the meaning; color is never the only signal).
 */
import type { AnnouncementAudience } from './types';

export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: 'Everyone',
  teachers: 'Teachers',
  students: 'Students',
  class: 'Class',
};

/** StatusBadge kind per audience — a neutral, consistent visual accent. */
export const AUDIENCE_KIND: Record<AnnouncementAudience, 'info' | 'success' | 'warning' | 'neutral'> =
  {
    all: 'info',
    teachers: 'success',
    students: 'warning',
    class: 'neutral',
  };

/** Format an RFC3339 instant to a short date (e.g. "Oct 15, 2025"). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format an RFC3339 instant to date + time (detail view). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** For a datetime-local input value (YYYY-MM-DDTHH:mm) → RFC3339-ish, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** RFC3339 → datetime-local input value (YYYY-MM-DDTHH:mm) in local time. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}
