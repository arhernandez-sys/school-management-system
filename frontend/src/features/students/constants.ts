import type { StatusKind } from '@shared/components';
import type { StudentStatus } from '@shared/types/enums';

/**
 * Student status → {@link StatusBadge} kind / display label. Shared by the detail page header
 * actions (the status-change dialog + toast) and the {@link StudentProfileSummary} hero card so
 * the status vocabulary can never drift between them.
 */
export const STUDENT_STATUS_KIND: Record<StudentStatus, StatusKind> = {
  active: 'success',
  inactive: 'neutral',
  transferred: 'info',
  graduated: 'info',
  withdrawn: 'neutral',
};

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  transferred: 'Transferred',
  graduated: 'Graduated',
  withdrawn: 'Withdrawn',
};

export const STUDENT_STATUS_OPTIONS: StudentStatus[] = [
  'active',
  'inactive',
  'transferred',
  'graduated',
  'withdrawn',
];
