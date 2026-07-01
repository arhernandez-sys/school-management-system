import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';

/**
 * StatusBadge — single source of truth for status color + label (design-system §5 #12).
 *
 * Promoted from the Phase-6 stub for Settings/Subjects (active/retired subject,
 * active/inactive user, academic-year active/archived). Maps a small closed set of
 * semantic statuses to MUI palette colors so status reads consistently everywhere.
 * Color is never the only signal — the text label always carries the meaning (WCAG 1.4.1).
 */
export type StatusKind = 'success' | 'neutral' | 'warning' | 'error' | 'info';

export interface StatusBadgeProps {
  label: string;
  kind?: StatusKind;
  size?: ChipProps['size'];
}

const KIND_TO_COLOR: Record<StatusKind, ChipProps['color']> = {
  success: 'success',
  neutral: 'default',
  warning: 'warning',
  error: 'error',
  info: 'info',
};

export function StatusBadge({ label, kind = 'neutral', size = 'small' }: StatusBadgeProps) {
  return <Chip label={label} color={KIND_TO_COLOR[kind]} size={size} variant="outlined" />;
}

export default StatusBadge;
