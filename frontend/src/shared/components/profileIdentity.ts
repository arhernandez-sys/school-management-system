import type { StatCardColor } from './StatCard';

/**
 * Pure identity helpers shared by the profile hero cards (teacher · student · …).
 *
 * Kept in a non-component module so {@link ProfileParts} can export only components (React Fast
 * Refresh requires component files to export components only).
 */

/** Palette accents cycled for deterministic avatar tints and profile progress bars. */
export const PROFILE_ACCENTS: StatCardColor[] = [
  'primary',
  'secondary',
  'info',
  'success',
  'warning',
];

/** First + last initial, e.g. "Maria Reyes" → "MR". Falls back to the first letter. */
export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Deterministic palette color from a name, so a photo-less avatar gets a stable, lively tint
 * instead of flat grey (same name → same color across renders). Not security-sensitive.
 */
export function avatarAccent(name: string): StatCardColor {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PROFILE_ACCENTS[Math.abs(hash) % PROFILE_ACCENTS.length]!;
}
