import type { StatusKind } from '@shared/components';
import { STUDENT_STATUSES, type StudentStatus } from '@shared/types/enums';

/**
 * Student status → {@link StatusBadge} kind / display label. Shared by the detail page header
 * actions (the status-change dialog + toast) and the {@link StudentProfileSummary} hero card so
 * the status vocabulary can never drift between them.
 */
export const STUDENT_STATUS_KIND: Record<StudentStatus, StatusKind> = {
  // Pre-enrolment. Neither good nor bad news yet.
  Applicant: 'neutral',
  Accepted: 'info',
  Active: 'success',
  // Not an error state: the client's definition is "completed the last semester but is not
  // continuing", so it reads neutral rather than warning.
  Inactive: 'neutral',
  // Imposed by the college, not chosen by the student — the one pause that IS a warning.
  Suspended: 'warning',
  Completed: 'info',
  Graduated: 'success',
  Alumni: 'info',
  Withdrawn: 'neutral',
  // A negative outcome — a student who left mid-programme — and the status that should
  // draw the eye on a register.
  Dropout: 'error',
  Transferred: 'info',
};

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  // D45 — every stored value is now display-ready TitleCase, so these are one-to-one.
  // `DropOut: 'Drop out'` is gone with the value it renamed.
  Applicant: 'Applicant',
  Accepted: 'Accepted',
  Active: 'Active',
  Inactive: 'Inactive',
  Suspended: 'Suspended',
  Completed: 'Completed',
  Graduated: 'Graduated',
  Alumni: 'Alumni',
  Withdrawn: 'Withdrawn',
  Dropout: 'Dropout',
  Transferred: 'Transferred',
};

/**
 * The status dropdown, in LIFECYCLE order rather than alphabetical.
 *
 * Sourced from `STUDENT_STATUSES` so the list cannot drift from the type: adding a value
 * to the union without adding it here would otherwise leave a status that exists, renders
 * on a badge, and cannot be selected.
 */
export const STUDENT_STATUS_OPTIONS: readonly StudentStatus[] = STUDENT_STATUSES;

