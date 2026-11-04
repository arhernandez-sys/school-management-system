import { useEffect, useState } from 'react';
import { Alert, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { formatSchoolDateTime } from '@shared/utils/schoolDate';
import { useRequestReopen } from '../hooks/useReopenRequests';

/**
 * D47 — the Lecturer asks the Dean to reopen a closed marking window. The same shape as
 * `RequestRevisionDialog`: a required reason, the server's messages surfaced verbatim.
 * Requesting writes no mark; only the Dean's approval opens entry again.
 */
export interface RequestReopenDialogProps {
  open: boolean;
  assessmentId: string;
  assessmentTitle: string;
  /** When entry locked — shown so the request is concrete. */
  closedAt: string | null;
  /** How many students have no mark (and so currently count as 0). */
  blankCount: number;
  onClose: () => void;
}

export function RequestReopenDialog({
  open,
  assessmentId,
  assessmentTitle,
  closedAt,
  blankCount,
  onClose,
}: RequestReopenDialogProps) {
  const requestMut = useRequestReopen();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
    setFieldErrors({});
  }, [open]);

  const submit = () => {
    setError(null);
    setFieldErrors({});
    requestMut.mutate(
      { assessmentId, reason: reason.trim() },
      {
        onSuccess: onClose,
        onError: (err) => {
          setError(apiErrorMessage(err));
          setFieldErrors(fieldErrorsFrom(err) ?? {});
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      title="Ask the Dean to reopen marking"
      submitLabel="Send to the Dean"
      submitting={requestMut.isPending}
      submitDisabled={reason.trim().length === 0}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Alert severity="info">
          The Dean decides how many days to reopen it for. Until then, students without a mark
          count as 0.
        </Alert>
        <Typography variant="body2">
          <strong>{assessmentTitle}</strong>
          {closedAt ? ` · marking closed ${formatSchoolDateTime(closedAt)}` : ''}
          {blankCount > 0
            ? ` · ${blankCount} ${blankCount === 1 ? 'student has' : 'students have'} no mark`
            : ''}
        </Typography>
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          fullWidth
          multiline
          minRows={3}
          autoFocus
          placeholder="e.g. I was out sick the week marking was due."
          error={Boolean(fieldErrors.reason)}
          helperText={fieldErrors.reason?.join(' ') ?? 'The Dean sees this.'}
        />
      </Stack>
    </FormDialog>
  );
}

export default RequestReopenDialog;
