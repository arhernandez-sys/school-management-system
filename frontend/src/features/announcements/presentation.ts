/**
 * Small presentation helpers shared across the Announcements screens — audience
 * labelling and locale-stable date/time formatting. Kept out of components so the
 * feed, detail, and form render labels consistently (design-system §5 #12: the text
 * label always carries the meaning; color is never the only signal).
 */
import type { Role } from '@shared/types/enums';
import { formatSchoolDate, formatSchoolDateTime } from '@shared/utils/schoolDate';
import { strings } from '@i18n/strings';
import type { AnnouncementAudience } from './types';

/**
 * D30: the KEYS are wire values and must not change (`teachers`, `class`); only the
 * labels are the tertiary terms.
 */
export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: 'Everyone',
  teachers: strings.terms.lecturers,
  students: strings.terms.students,
  class: strings.terms.course,
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
  // D43 — an HOD receives exactly what a lecturer does. Heading a programme changes
  // what they can SEE elsewhere in the app, not which notices are addressed to them.
  hod: ['all', 'teachers', 'class'],
  // The Auditor receives nothing targeted — nobody posts to auditors — but reads every
  // bucket, so the filter offers all four. Note `_authors` on the server does not
  // include them: they read the feed, they never write to it.
  auditor: ['all', 'teachers', 'students', 'class'],
  // D45 §2 — the System Administrator receives NOTHING. `all` is deliberately absent
  // even though it is the one bucket that reaches everybody: the central technical-scope
  // gate refuses this account `/announcements` outright (blueprint §48), so offering a
  // filter here would render a screen the server will not answer. An option that can
  // never match is worse than absent — it reads as "there are no announcements" rather
  // than "you cannot receive these", which is the same argument the rest of this map is
  // built on.
  sysadmin: [],
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
  teachers: 'All lecturers',
  class: 'My course',
};

/** Filter-menu label for `audience`, from the point of view of the reader. */
export function audienceFilterLabel(audience: AnnouncementAudience, role: Role): string {
  if (role === 'principal' || role === 'secretary') return AUDIENCE_LABEL[audience];
  // A lecturer owns several course offerings; a student is enrolled in several too, but
  // an announcement targets one, so the singular still reads correctly for them.
  if (audience === 'class') return role === 'teacher' ? 'My courses' : 'My course';
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
  // D39 (Meeting #2 item 1) — dd/mm/yyyy, school timezone, everywhere.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatSchoolDate(d);
}

/**
 * Format an RFC3339 instant to date + time (detail view).
 *
 * D42 §6 — delegates to `formatSchoolDateTime` rather than calling
 * `toLocaleString(undefined, …)`. The browser's locale printed `Aug 24, 2026, 5:00 PM`
 * here while `formatSchoolDate` above already rendered `24/08/2026` two lines away, so one
 * announcement showed two different date formats depending on which field you read.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatSchoolDateTime(iso);
}

/*
 * D42 §6 — `localInputToIso` / `isoToLocalInput` lived here. They existed only to feed a
 * native `<input type="datetime-local">`, which is gone: `DateTimeField` owns the
 * local↔UTC conversion for every datetime in the app now, and the announcement form holds
 * the UTC instant it actually sends.
 */
