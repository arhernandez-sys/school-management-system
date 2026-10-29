/**
 * D47 — how every screen describes an assessment's marking window. One place, so the
 * grading screen, the offering's assessment list and the dashboard never word it three
 * ways. The state itself is the SERVER's (`marking_open`, `days_left`, …); nothing here
 * re-derives it from dates.
 */
import type { StatusKind } from '@shared/components';
import { formatSchoolDate } from '@shared/utils/schoolDate';

/** Days a lecturer has to mark an assessment — mirrors `MARKING_WINDOW_DAYS` server-side. */
export const MARKING_WINDOW_DAYS = 5;

export interface MarkingFields {
  marking_open: boolean;
  effective_closes_at: string | null;
  reopened_until?: string | null;
  days_left: number | null;
}

/** "today", "1 day left", "3 days left". */
export function daysLeftLabel(daysLeft: number | null): string {
  if (daysLeft == null) return '';
  if (daysLeft <= 0) return 'closes today';
  return daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
}

/** A short badge: "Open · 3 days left", "Reopened · closes today", "Locked". */
export function markingBadge(a: MarkingFields): { label: string; kind: StatusKind } {
  if (!a.marking_open) return { label: 'Locked', kind: 'neutral' };
  const reopened = Boolean(a.reopened_until);
  const urgent = a.days_left != null && a.days_left <= 1;
  return {
    label: `${reopened ? 'Reopened' : 'Open'} · ${daysLeftLabel(a.days_left)}`,
    kind: urgent ? 'warning' : reopened ? 'info' : 'success',
  };
}

/** The date entry locks (or locked), dd/mm/yyyy in Belize. */
export function closesOn(a: MarkingFields): string {
  return formatSchoolDate(a.effective_closes_at);
}
