/**
 * Social Security numbers — shared by the application wizard, the student form and the
 * lecturer form, so all three store the same shape.
 *
 * 9 digits; the field accepts digits only. Shorter numbers are left-padded with zeros
 * (client request, 14 Oct 2026): typing `123` stores `000000123`. Blank stays blank —
 * the number is optional, and padding nothing would invent one nobody gave.
 */
export const SSNO_LENGTH = 9;

/** Strip everything but digits and cap at 9 — use on every keystroke. */
export const ssnoDigits = (value: string): string =>
  value.replace(/\D/g, '').slice(0, SSNO_LENGTH);

/** Left-pad to 9 digits — use on blur and again when building the payload. */
export const padSsno = (value: string): string => {
  const digits = ssnoDigits(value);
  return digits === '' ? '' : digits.padStart(SSNO_LENGTH, '0');
};
