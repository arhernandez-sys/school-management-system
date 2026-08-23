import type { StatusKind } from '@shared/components';
import type { StudentStatus } from '@shared/types/enums';

/**
 * Student status → {@link StatusBadge} kind / display label. Shared by the detail page header
 * actions (the status-change dialog + toast) and the {@link StudentProfileSummary} hero card so
 * the status vocabulary can never drift between them.
 */
export const STUDENT_STATUS_KIND: Record<StudentStatus, StatusKind> = {
  Registered: 'success',
  // Not an error state: the client's definition is "completed the last semester but is not
  // continuing", so it reads neutral rather than warning.
  Unregistered: 'neutral',
  // This one IS a negative outcome — a student who left mid-programme — and it is the only
  // status that should draw the eye on a register.
  DropOut: 'error',
  transferred: 'info',
  graduated: 'info',
  withdrawn: 'neutral',
};

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  // The stored values are already display-ready except DropOut, which gets a space. The
  // labels are what a Registrar reads; the VALUES are the client's and are not touched.
  Registered: 'Registered',
  Unregistered: 'Unregistered',
  DropOut: 'Drop out',
  transferred: 'Transferred',
  graduated: 'Graduated',
  withdrawn: 'Withdrawn',
};

export const STUDENT_STATUS_OPTIONS: StudentStatus[] = [
  'Registered',
  'Unregistered',
  'DropOut',
  'transferred',
  'graduated',
  'withdrawn',
];
