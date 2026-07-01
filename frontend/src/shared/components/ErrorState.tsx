import { Alert, AlertTitle, Box, Button } from '@mui/material';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Retry handler — typically a TanStack Query `refetch`. */
  onRetry?: () => void;
}

/** Inline error surface for failed queries with retry (design-system §5 #13, §10.3). */
export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load this. Please try again.",
  onRetry,
}: ErrorStateProps) {
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
