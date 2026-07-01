import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Top-level React error boundary (architecture §8.1). Catches render crashes and
 * shows a recoverable fallback instead of a white screen. Query/request errors are
 * handled by ErrorState at the region level — this is the last-resort net.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Phase 7: forward to a structured logger. Never log tokens/PII (NFR-SEC-03).
    console.error('Unhandled render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
          }}
        >
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Typography variant="h2" component="h1">
              Something went wrong
            </Typography>
            <Typography color="text.secondary">
              An unexpected error occurred. Try reloading the page.
            </Typography>
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
