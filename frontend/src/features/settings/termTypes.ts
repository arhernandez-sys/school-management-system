/**
 * The session-type vocabulary, in ONE place (D44).
 *
 * Before this, `AcademicStructureScreen` and `TermFormDialog` each carried an identical
 * `{ value, label }[]`, and the sessions table printed `{sem.term_type}` raw under a
 * `textTransform: 'capitalize'`. Adding `independent` therefore meant editing three
 * places, one of which was not a list at all — and the raw render is how a new value
 * silently ships as lowercase machine text next to three properly-labelled ones.
 *
 * ⚠️ THE WIRE VALUE IS LOWERCASE. The client's `sims_10` dump spells the new label
 * `'Independent'`, capitalised, alone among the four. It is stored lowercase (see
 * `017_sims10_reconcile.sql` §5 for why: MariaDB returns an enum label as DECLARED, and
 * SQLAlchemy maps `TermType` by exact value, so a capitalised column would raise on every
 * read). The capital lives here, in the label, which is where a display decision belongs.
 */

import type { TermType } from '@shared/api/generated/model';

export const TERM_TYPE_LABEL: Record<TermType, string> = {
  semester: 'Semester',
  summer: 'Summer block',
  spring: 'Spring block',
  // D44. "Independent study" rather than the client's bare "Independent": on a row that
  // also reads "Summer block" and "Spring block", a single adjective does not say what
  // kind of thing it is.
  independent: 'Independent study',
};

/**
 * Options for a `<Select>`, in the order BAJC actually uses them — the numbered semesters
 * carry the year, the blocks sit between them, and independent study is the exception.
 *
 * `Record<TermType, string>` above is deliberate: a term type added to the enum without a
 * label becomes a type error rather than a blank dropdown entry.
 */
export const TERM_TYPE_OPTIONS: ReadonlyArray<{ value: TermType; label: string }> = [
  { value: 'semester', label: TERM_TYPE_LABEL.semester },
  { value: 'summer', label: TERM_TYPE_LABEL.summer },
  { value: 'spring', label: TERM_TYPE_LABEL.spring },
  { value: 'independent', label: TERM_TYPE_LABEL.independent },
];

/** Display name for a session type, e.g. `termTypeLabel('independent')`. */
export function termTypeLabel(value: TermType): string {
  return TERM_TYPE_LABEL[value];
}
