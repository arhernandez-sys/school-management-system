/**
 * The `School year` option list (D37).
 *
 * `applications.school_year` is a free-text LABEL the applicant declares — distinct from
 * `academic_year_id`, the real FK set at acceptance. Free text let the two diverge, and
 * they already have: the one live application says `2026-2027` while the academic years on
 * file are `2024-2025` and `2025-2026`. Nothing reconciles them, so a Registrar filtering
 * or reporting on the label gets a value that matches no year in the system.
 *
 * **Why the list is not simply "the academic years that exist".** An application is for a
 * FUTURE intake, so the year it names routinely will not exist as a row yet — that is
 * exactly what the live data shows. A strict dropdown of existing years would block the
 * normal case: recording next year's applications before the Dean has created next year.
 *
 * So the options are the years on file PLUS the next few derived from the latest one, all
 * in one `YYYY-YYYY` format. That fixes the formatting drift (which is what makes the
 * label unusable) without blocking a forward-dated application.
 */

/** How many future years to offer beyond the latest one on file. */
const FUTURE_YEARS = 3;

/** `2025-2026` -> `2026-2027`. Returns null for anything not in that shape. */
function nextLabel(label: string): string | null {
  const match = /^(\d{4})\s*-\s*(\d{4})$/.exec(label.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  // Only step a label whose halves are consecutive; `2024-2026` is not a school year and
  // guessing what it meant would invent data.
  if (end !== start + 1) return null;
  return `${start + 1}-${end + 1}`;
}

/**
 * The option list, newest first.
 *
 * `current` is included even when it is not derivable from the years on file, so opening
 * an EXISTING application never silently drops the value it already holds — a select whose
 * value is absent from its options renders blank, and saving would then clear the field.
 */
export function schoolYearOptions(
  academicYearNames: readonly string[],
  current?: string | null,
): string[] {
  const options = new Set<string>();
  for (const name of academicYearNames) {
    const trimmed = name.trim();
    if (trimmed) options.add(trimmed);
  }

  // Walk forward from the latest well-formed label on file.
  const seed = [...options].sort().at(-1);
  let cursor = seed ?? null;
  for (let i = 0; i < FUTURE_YEARS && cursor; i += 1) {
    cursor = nextLabel(cursor);
    if (cursor) options.add(cursor);
  }

  const held = current?.trim();
  if (held) options.add(held);

  // Descending: an application being filed is for the newest year, not the oldest.
  return [...options].sort().reverse();
}
