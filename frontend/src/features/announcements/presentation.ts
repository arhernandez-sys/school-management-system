/**
 * Small presentation helpers shared across the Announcements screens — audience
 * labelling and locale-stable date/time formatting. Kept out of components so the
 * feed, detail, and form render labels consistently (design-system §5 #12: the text
 * label always carries the meaning; color is never the only signal).
 */
import type { Role } from '@shared/types/enums';
import type { AnnouncementAudience } from './types';

export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: 'Everyone',
  teachers: 'Teachers',
  students: 'Students',
  class: 'Class',
};

/**
 * Audience values a role can actually RECEIVE — the options its feed filter should offer.
 *
 * The filter used to offer all four to everybody, so a student could pick "Teachers" and
 * get a guaranteed-empty list: the server only ever sends them `all`, `students` and
 * their own `class` notices (`_audience_clause` in the announcements service). An option
 * that can never match is worse than absent — it reads as "there are no announcements"
 * rather than "you cannot receive these".
 *
 * Principal and secretary keep all four: they are the broadcast authors and the backend
 * treats them as equivalent, so they need to see each bucket they can post to.
 */
export const RECEIVABLE_AUDIENCES: Record<Role, AnnouncementAudience[]> = {
  principal: ['all', 'teachers', 'students', 'class'],
  secretary: ['all', 'teachers', 'students', 'class'],
  teacher: ['all', 'teachers', 'class'],
  student: ['all', 'students', 'class'],
};

/**
 * Reader-facing filter labels. `AUDIENCE_LABEL` describes an announcement's audience
 * as the AUTHOR set it ("Students" = "I sent this to all students"); in a filter the
 * same word has to answer "which of my notices do I want?", so the wording is
 * possessive. Kept separate rather than overloading one map, because the badge on each
 * card must keep saying what the author chose.
 */
const AUDIENCE_FILTER_LABEL: Partial<Record<AnnouncementAudience, string>> = {
  all: 'School-wide',
  students: 'All students',
  teachers: 'All teachers',
  class: 'My class',
};

/** Filter-menu label for `audience`, from the point of view of the reader. */
export function audienceFilterLabel(audience: AnnouncementAudience, role: Role): string {
  if (role === 'principal' || role === 'secretary') return AUDIENCE_LABEL[audience];
  // A student sits in exactly one section; a teacher owns several.
  if (audience === 'class') return role === 'teacher' ? 'My classes' : 'My class';
  return AUDIENCE_FILTER_LABEL[audience] ?? AUDIENCE_LABEL[audience];
}

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
