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

/** Map a letter band to a semantic StatusBadge kind (passing → success, F → error). */
function kindForLetter(letter: string): StatusKind {
  switch (letter.toUpperCase()) {
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
