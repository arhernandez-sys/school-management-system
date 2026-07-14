import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import type { StatCardColor } from './StatCard';

export interface LabeledProgressProps {
  /** Row label (e.g. an expertise area). */
  label: string;
  /** Completion 0–100; clamped before rendering. */
  value: number;
  /** Accent color for the bar; defaults to primary. */
  color?: StatCardColor;
}

/**
 * LabeledProgress — a captioned determinate progress row (label · `value%` · bar).
 *
 * Mirrors {@link StatCard}'s slim bar styling (height 6, radius 3, palette color) so
 * profile "Subject Expertise" bars read as part of the same system. The percentage is
 * shown as text and the bar carries an `aria-label`, so the value never depends on
 * color alone (WCAG 1.4.1).
 */
export function LabeledProgress({ label, value, color = 'primary' }: LabeledProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }} noWrap>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, flexShrink: 0 }}>
          {clamped}%
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={clamped}
        color={color}
        aria-label={`${label}: ${clamped}%`}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  );
}

export default LabeledProgress;
