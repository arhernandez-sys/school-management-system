import type { YearResult } from './types';

/**
 * How a student's year reads on screen. `year_of_study` arrives already scoped to the
 * year being viewed (the server reads `student_year_records`), so this only words it.
 *
 *  - "First"                 — the year is running, nothing unusual
 *  - "First · repeating"     — sitting First again (last year ended in Repeating)
 *  - "First · passed"        — a past year that ended in promotion
 *  - "First · not passed"    — a past year that ended in Repeating
 *  - "Second · completed"    — a past year that finished the programme
 */
export const YEAR_RESULT_LABEL: Record<YearResult, string> = {
  Promoted: 'passed',
  Repeating: 'not passed',
  Completed: 'completed',
};

export function yearStandingText(s: {
  year_of_study: string | null;
  year_result?: YearResult | null;
  repeating?: boolean;
}): string {
  if (!s.year_of_study) return '—';
  const parts = [s.year_of_study];
  if (s.repeating) parts.push('repeating');
  if (s.year_result) parts.push(YEAR_RESULT_LABEL[s.year_result]);
  return parts.join(' · ');
}
