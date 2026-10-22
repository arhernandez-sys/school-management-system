/**
 * Person-name display helpers (D30 §D10, D33).
 *
 * Names are STORED AND SORTED IN PARTS — `last_name`, `first_name`, `middle_name` — and
 * `full_name` is a computed display string the server assembles for convenience
 * (`StudentProfile.full_name`). Neither of those is the register format, which is what
 * this module adds.
 */

/** Anything carrying split name parts: students, applicants, teachers. */
export interface NameParts {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  /** Server-assembled "First Middle Last" — used as the fallback. */
  full_name?: string | null;
}

/**
 * `"Perez, Ana"` — surname first, the way a register reads (D33, client ask 5).
 *
 * This is a DISPLAY string only. **It is never a sort key**: listings sort on the API's
 * `last_name` field, which the server expands to `(last_name, first_name, id)` via
 * `STUDENT_NAME_ORDER`. Sorting on this string would collate the comma and the space,
 * which is not the same ordering — see the warning on `StudentProfile.full_name`.
 *
 * Degrades rather than producing punctuation with nothing around it:
 *
 * * both parts     → `"Perez, Ana"`
 * * surname only   → `"Perez"` (the legacy single-token rows `005_tertiary.sql` §9 parked
 *                    in `lastname` with a NULL given name)
 * * no surname     → whatever `full_name` holds, else `""`
 *
 * The middle name is deliberately left out. It is on the profile and in the form; in a
 * table column it costs width on every row to disambiguate almost none of them.
 */
export function surnameFirst(person: NameParts): string {
  const last = person.last_name?.trim() ?? '';
  const first = person.first_name?.trim() ?? '';
  if (last && first) return `${last}, ${first}`;
  if (last) return last;
  return person.full_name?.trim() ?? first;
}
