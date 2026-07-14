import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * StatCard — dashboard metric tile (design-system §5 #7).
 *
 * A compact metric: a label, a large value, an optional icon and an optional delta
 * (period-over-period change). Uses theme palette tokens only (no raw hex) and a flat
 * hairline-border surface (D19). Renders a skeleton while `loading`.
 *
 * Accessibility: the delta's direction is conveyed by both an arrow icon AND the sign
 * of the text (never color alone, WCAG 1.4.1); the whole tile is a labelled group.
 */
export type StatCardColor = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Signed change vs the previous period; positive renders up, negative down. */
  delta?: number;
  /** Unit appended to the delta (e.g. "%", " students"). */
  deltaSuffix?: string;
  /** Leading icon element (e.g. an MUI icon). */
  icon?: ReactNode;
  /** Accent color for the icon chip; defaults to primary. */
  color?: StatCardColor;
  loading?: boolean;
  /** Optional helper text under the value. */
  helperText?: string;
  /**
   * Optional completion figure (0–100). When set, a slim determinate progress bar is
   * rendered under the value/delta area (matching the reference "metric with a progress
   * bar" pattern). The bar takes the card's `color`. Omitted entirely when undefined.
   */
  progress?: number;
  /** Small caption shown under the progress bar (e.g. "80% of capacity"). */
  progressLabel?: string;
  /**
   * Optional in-app route. When set, the whole tile becomes a clickable shortcut
   * (CardActionArea + RouterLink) to that destination, with a trailing chevron
   * affordance — turning a passive metric into an action (design-system §7.2).
   */
  to?: string;
}

export function StatCard({
  label,
  value,
  delta,
  deltaSuffix = '',
  icon,
  color = 'primary',
  loading = false,
  helperText,
  progress,
  progressLabel,
  to,
}: StatCardProps) {
  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="40%" height={44} />
          <Skeleton variant="text" width="30%" />
        </CardContent>
      </Card>
    );
  }

  const hasDelta = typeof delta === 'number' && delta !== 0;
  const deltaUp = (delta ?? 0) > 0;

  const body = (
    <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
          {icon && (
            <Box
              aria-hidden
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 2,
                flexShrink: 0,
                // Soft palette-derived tint (no raw hex): accent icon on a 12%-alpha chip.
                color: theme.palette[color].main,
                bgcolor: alpha(theme.palette[color].main, 0.12),
              })}
            >
              {icon}
            </Box>
          )}
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" color="text.secondary" noWrap>
              {label}
            </Typography>
            <Typography variant="h2" component="p" sx={{ lineHeight: 1.1, mt: 0.5 }}>
              {value}
            </Typography>
            {hasDelta && (
              <Stack
                direction="row"
                spacing={0.25}
                sx={{
                  alignItems: 'center',
                  mt: 0.5,
                  color: deltaUp ? 'success.main' : 'error.main',
                }}
              >
                {deltaUp ? (
                  <ArrowUpwardIcon fontSize="inherit" aria-hidden />
                ) : (
                  <ArrowDownwardIcon fontSize="inherit" aria-hidden />
                )}
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {deltaUp ? '+' : ''}
                  {delta}
                  {deltaSuffix}
                </Typography>
              </Stack>
            )}
            {helperText && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {helperText}
              </Typography>
            )}
            {typeof progress === 'number' && (
              <Box sx={{ mt: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={Math.max(0, Math.min(100, progress))}
                  color={color}
                  aria-label={progressLabel ?? `${label} progress`}
                  sx={{ height: 6, borderRadius: 3 }}
                />
                {progressLabel && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5 }}
                  >
                    {progressLabel}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          {to && (
            <ChevronRightIcon
              aria-hidden
              fontSize="small"
              sx={{ color: 'text.disabled', alignSelf: 'center', flexShrink: 0 }}
            />
          )}
        </Stack>
      </CardContent>
  );

  if (to) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardActionArea
          component={RouterLink}
          to={to}
          aria-label={`${label}: ${String(value)} — open`}
          sx={{ height: '100%' }}
        >
          {body}
        </CardActionArea>
      </Card>
    );
  }

  return (
    <Card variant="outlined" role="group" aria-label={`${label}: ${String(value)}`} sx={{ height: '100%' }}>
      {body}
    </Card>
  );
}

export default StatCard;
