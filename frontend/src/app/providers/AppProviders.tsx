import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'dayjs/locale/en-gb';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { theme } from '@theme/index';
import { queryClient } from './queryClient';
import { AuthProvider } from '@features/auth/context/AuthProvider';
import { YearProvider } from './YearContext';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Composes all top-level providers (architecture §5 main.tsx bootstrap):
 *   ErrorBoundary → ThemeProvider(+CssBaseline) → LocalizationProvider →
 *   QueryClientProvider → AuthProvider
 *
 * Order matters: AuthProvider's bootstrap refresh uses the HTTP client (independent
 * of React Query), but lives inside QueryClientProvider so feature hooks can read
 * auth + query state together. Theme wraps everything so loading states are themed.
 *
 * **`adapterLocale="en-gb"` is the whole point of the LocalizationProvider (D42 §6).**
 * Every date control in the app was a native `<input type="date">`, which renders in the
 * BROWSER's locale and cannot be told otherwise — so a Belize school on a US-locale machine
 * typed and read mm/dd/yyyy throughout. `en-gb` is day-first, which makes DD/MM/YYYY the
 * parse AND display format for every `DateField` / `DateTimeField` below it, in one place
 * rather than twenty-four.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme} defaultMode="light">
        <CssBaseline />
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <YearProvider>{children}</YearProvider>
            </AuthProvider>
            {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
          </QueryClientProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default AppProviders;
