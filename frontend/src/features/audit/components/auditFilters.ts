/**
 * The audit trail's filter STATE — the value object, its empty form, and how many of it
 * are active.
 *
 * Split out of `AuditFiltersDialog.tsx` so that file exports only a component: mixing
 * values and components in one module breaks React Fast Refresh. The same seam
 * `features/students/components/studentFilters.ts` uses, and for the same reason — the
 * page needs the shape and the counter without needing the dialog.
 */

/**
 * Every filter the audit trail accepts, as one value object.
 *
 * `search` is deliberately NOT in here. It lives in the toolbar because it is typed
 * continuously and debounced — putting the one control people use constantly behind an
 * Apply button would make it the slowest one to use.
 */
export interface AuditFilterValues {
  /** One of the four §53 audit reports, by key. Empty = all activity. */
  report: string;
  /** A functional area ("Grades", "Registration"), not a table. Empty = every area. */
  module: string;
  /** An actor's user id. Empty = anyone. */
  actorUserId: string;
  /** School-local (America/Belize) dates, `YYYY-MM-DD`, both ends inclusive. */
  fromDate: string;
  toDate: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilterValues = {
  report: '',
  module: '',
  actorUserId: '',
  fromDate: '',
  toDate: '',
};

/** How many filters are narrowing the trail. Drives the toolbar button's badge. */
export function activeAuditFilterCount(v: AuditFilterValues): number {
  let n = 0;
  if (v.report) n += 1;
  if (v.module) n += 1;
  if (v.actorUserId) n += 1;
  // The two dates count SEPARATELY. "From 1 September" and "1–30 September" are
  // different questions, and a reader surprised by a row count needs the badge to
  // account for both ends of the range rather than calling them one filter.
  if (v.fromDate) n += 1;
  if (v.toDate) n += 1;
  return n;
}
