import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { theme } from '@theme/index';
import { queryClient } from './queryClient';
import { AuthProvider } from '@features/auth/context/AuthProvider';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Composes all top-level providers (architecture §5 main.tsx bootstrap):
 *   ErrorBoundary → ThemeProvider(+CssBaseline) → QueryClientProvider → AuthProvider
 *
 * Order matters: AuthProvider's bootstrap refresh uses the HTTP client (independent
 * of React Query), but lives inside QueryClientProvider so feature hooks can read
 * auth + query state together. Theme wraps everything so loading states are themed.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme} defaultMode="light">
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default AppProviders;
