import { Box, CircularProgress, Skeleton, Stack, Typography } from '@mui/material';

export interface LoadingStateProps {
  /** Shape of the skeleton to render (design-system §5 #3, §10.1). */
  variant?: 'table' | 'cards' | 'form' | 'inline' | 'page';
  /** Number of skeleton rows/cards. */
  rows?: number;
  /** Accessible label announced while busy. */
  label?: string;
}

/**
 * Consistent loading surface — skeletons for content shape (no layout jump),
 * spinner only for short/blocking/indeterminate waits. WCAG: aria-busy region.
 */
export function LoadingState({ variant = 'inline', rows = 4, label = 'Loading' }: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <Box
        role="status"
        aria-busy="true"
        aria-label={label}
        sx={{ display: 'flex', justifyContent: 'center', p: 3 }}
      >
        <CircularProgress aria-hidden />
      </Box>
    );
  }

  if (variant === 'page') {
    return (
      <Box
        role="status"
        aria-busy="true"
        aria-label={label}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 2,
        }}
      >
        <CircularProgress aria-hidden />
        <Typography color="text.secondary">{label}…</Typography>
      </Box>
    );
  }

  const lineHeight = variant === 'cards' ? 96 : variant === 'form' ? 56 : 40;
  return (
    <Stack spacing={1} role="status" aria-busy="true" aria-label={label} sx={{ p: 1 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={lineHeight} />
      ))}
    </Stack>
  );
}

export default LoadingState;
