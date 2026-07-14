/**
 * Presentation helpers shared across the gradebook cells, term column and My Grades.
 * Color is NEVER the only signal — the letter/label always carries the meaning
 * (WCAG 1.4.1); these just pick a consistent semantic accent per band/status.
 */
import type { StatusKind } from '@shared/components';
import type { GradeStatus } from '@shared/types/enums';

/** Map a derived letter grade to a semantic StatusBadge kind (A/B pass … F fail). */
export function letterKind(letter: string | null | undefined): StatusKind {
  switch ((letter ?? '').toUpperCase()) {
    case 'A':
      return 'success';
    case 'B':
      return 'info';
    case 'C':
      return 'warning';
    case 'D':
      return 'warning';
    case 'F':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Human label + StatusBadge kind for a non-graded cell status. */
export function statusPresentation(status: GradeStatus): { label: string; kind: StatusKind } {
  switch (status) {
    case 'absent':
      return { label: 'Absent', kind: 'error' };
    case 'excused':
      return { label: 'Excused', kind: 'info' };
    case 'exempt':
      return { label: 'Exempt', kind: 'neutral' };
    case 'pending':
      return { label: 'Pending', kind: 'neutral' };
    case 'graded':
      return { label: 'Graded', kind: 'success' };
    default:
      return { label: status, kind: 'neutral' };
  }
}

/** Format a term-grade numeric (compute-on-read) or the "—" placeholder. */
export function formatNumeric(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(1);
}

/** The set of statuses that carry an editable numeric score. */
export const SCORED_STATUS: GradeStatus = 'graded';
