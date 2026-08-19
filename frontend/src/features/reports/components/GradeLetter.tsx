import { StatusBadge } from '@shared/components';
import type { StatusKind } from '@shared/components';

/**
 * Grade letter badge — consistent letter→color mapping for report cards & the
 * transcript (design-system §7.10: color + letter + number, never color alone). The
 * numeric value is rendered alongside by the caller; this shows the letter chip.
 */
export interface GradeLetterProps {
  letter: string | null;
}

/**
 * Map a letter band to a semantic StatusBadge kind.
 *
 * **Modifiers are stripped first** (D30 §D5). BAJC's 8-band scale introduced `A-`,
 * `B+` and `C+`, and an exact-match switch sent every one of them to the `neutral`
 * default — so a 92 (A-) and a 71 (C) would have printed the same grey chip. The
 * band's family is what the colour is about, so `A-` reads as an A.
 *
 * D is `warning` and F is `error` even though **both are failing grades at BAJC** (D
 * is priced 1.00, below every programme's minimum). The distinction is kept because
 * the two are different conversations, and because §7.10 makes the letter — not the
 * colour — the authoritative signal.
 */
function kindForLetter(letter: string): StatusKind {
  const base = letter.trim().toUpperCase().replace(/[+-]+$/, '');
  switch (base) {
    case 'A':
      return 'success';
    case 'B':
      return 'info';
    case 'C':
      return 'neutral';
    case 'D':
      return 'warning';
    case 'F':
      return 'error';
    default:
      return 'neutral';
  }
}

export function GradeLetter({ letter }: GradeLetterProps) {
  if (!letter) return <span aria-hidden>—</span>;
  return <StatusBadge label={letter} kind={kindForLetter(letter)} />;
}

export default GradeLetter;
