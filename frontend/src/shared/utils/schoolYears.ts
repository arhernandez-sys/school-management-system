/**
 * The `School year` option list (D37).
 *
 * `applications.school_year` is a LABEL distinct from `academic_year_id`, the real FK set
 * at acceptance. Free text let the two diverge (the one live application said `2026-2027`
 * while no such year was on file), so the field is a select.
 *
 * The options are exactly the academic years in the database (`/settings/academic-years`)
 * — no derived future years. To take applications for a new intake, the Dean creates that
 * academic year first, and it then appears here.
 */

/**
 * The option list, newest first.
 *
 * `current` is included even when it is not on file, so opening an EXISTING application
 * never silently drops the value it already holds — a select whose value is absent from
 * its options renders blank, and saving would then clear the field.
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

  const held = current?.trim();
  if (held) options.add(held);

  // Descending: an application being filed is for the newest year, not the oldest.
  return [...options].sort().reverse();
}
