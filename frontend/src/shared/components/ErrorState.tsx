import { Alert, AlertTitle, Box, Button } from '@mui/material';
import { isNoAcademicYearError } from '@shared/api/setupState';
import { NoAcademicYearState } from './NoAcademicYearState';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Retry handler — typically a TanStack Query `refetch`. */
  onRetry?: () => void;
  /**
   * The failed query's `error`. Pass it whenever the endpoint can answer "no academic
   * year yet" (`isNoAcademicYearError`): that SETUP state then renders as a neutral
   * empty state with no Retry, and only a real failure gets the red box.
   */
  error?: unknown;
}

/** Inline error surface for failed queries with retry (design-system §5 #13, §10.3). */
export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load this. Please try again.",
  onRetry,
  error,
}: ErrorStateProps) {
  if (isNoAcademicYearError(error)) {
    return <NoAcademicYearState />;
  }

  return (
    <Box sx={{ p: 2 }}>
      <Alert
        severity="error"
        role="alert"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        <AlertTitle>{title}</AlertTitle>
        {message}
      </Alert>
    </Box>
  );
}

export default ErrorState;
