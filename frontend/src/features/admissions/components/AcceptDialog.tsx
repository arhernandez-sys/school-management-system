import { useState } from 'react';
import { Alert, AlertTitle, Box, Stack, TextField } from '@mui/material';
import { FormDialog, DateField } from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { useAcceptApplication } from '../hooks/useAdmissions';
import type { ApplicationDetail } from '../types';

/**
 * Acceptance — the college offers the applicant a place. **That is all it does (D46).**
 *
 * ⚠️ D46 (client, Oct 2026) split what decision #5 had fused. Accepting used to create the
 * student record, the login and the student ID in one step, which made every accepted
 * applicant a student — in the list, enrollable on offerings — whether or not they ever
 * registered. Now the student, the ID and the (optional) login are created by
 * {@link EnrollDialog} when the applicant actually enrols. So there is no login field
 * here any more.
 */
export interface AcceptDialogProps {
  open: boolean;
  application: ApplicationDetail;
  onClose: () => void;
  /** Called after a successful accept. */
  onAccepted: (result: ApplicationDetail) => void;
}

export function AcceptDialog({ open, application, onClose, onAccepted }: AcceptDialogProps) {
  const acceptMut = useAcceptApplication();
  const [dateAccepted, setDateAccepted] = useState('');
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const blocked = application.blocking_issues;

  const reset = () => {
    setDateAccepted('');
    setComments('');
    setError(null);
    setIssues([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    setError(null);
    setIssues([]);
    acceptMut.mutate(
      {
        id: application.id,
        body: {
          date_accepted: dateAccepted || null,
          comments: comments.trim() || null,
        },
      },
      {
        onSuccess: (result) => {
          onAccepted(result);
          close();
        },
        onError: (err) => {
          setError(apiErrorMessage(err));
          setIssues(fieldErrorsFrom(err)?.application ?? []);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      title="Accept this application"
      submitLabel="Accept"
      submitting={acceptMut.isPending}
      submitDisabled={blocked.length > 0}
      error={error}
      maxWidth="sm"
      onClose={close}
      onSubmit={submit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        {blocked.length > 0 ? (
          <Alert severity="warning">
            <AlertTitle>Not ready to accept</AlertTitle>
            <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
              {blocked.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </Box>
          </Alert>
        ) : (
          <Alert severity="info">
            This offers <strong>{application.full_name}</strong> a place. It does{' '}
            <strong>not</strong> create a student record, a student ID or a login. Those are created
            when they <strong>enrol</strong>. Until then they won&apos;t appear in the student list
            and can&apos;t be added to an offering.
          </Alert>
        )}

        {issues.length > 0 && (
          <Alert severity="error">
            <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </Box>
          </Alert>
        )}

        <DateField
          label="Date accepted"
          value={dateAccepted}
          onChange={setDateAccepted}
          fullWidth
          helperText="Defaults to today. Set it when the decision was made earlier than the keying-in."
        />
        <TextField
          label="Comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          helperText="Appended to the official-use block; earlier notes are kept."
        />
      </Stack>
    </FormDialog>
  );
}

export default AcceptDialog;
