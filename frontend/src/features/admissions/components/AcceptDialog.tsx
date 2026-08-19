import { useState } from 'react';
import { Alert, AlertTitle, Box, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { useAcceptApplication } from '../hooks/useAdmissions';
import type { AcceptResponse, ApplicationDetail } from '../types';

/**
 * Acceptance (decision #5) — the single action that creates the student, the login and the
 * `YYYYMM###` student ID.
 *
 * **It takes almost no input, on purpose.** The student is built from Sections A–E of the
 * application, not from fields typed here, so an accept can never quietly disagree with the
 * form it came from. The only inputs are things the FORM cannot answer: which academic year
 * to admit into, when the decision was actually made, and a login email when the applicant
 * gave none.
 *
 * The temporary password comes back **once**. It is not re-fetchable, so the dialog stays
 * open on the result until the Registrar dismisses it rather than closing over the one
 * chance to write it down.
 */
export interface AcceptDialogProps {
  open: boolean;
  application: ApplicationDetail;
  onClose: () => void;
  /** Called after a successful accept, once the result has been shown. */
  onAccepted: (result: AcceptResponse) => void;
}

export function AcceptDialog({ open, application, onClose, onAccepted }: AcceptDialogProps) {
  const acceptMut = useAcceptApplication();
  const [loginEmail, setLoginEmail] = useState('');
  const [dateAccepted, setDateAccepted] = useState('');
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [result, setResult] = useState<AcceptResponse | null>(null);

  const needsEmail = !application.email;
  const blocked = application.blocking_issues.filter(
    // The Registrar can satisfy this one right here, so it is not a blocker in this dialog.
    (issue) => !(needsEmail && issue.startsWith('An email address is required')),
  );

  const submit = () => {
    setError(null);
    setIssues([]);
    acceptMut.mutate(
      {
        id: application.id,
        body: {
          login_email: loginEmail.trim() || null,
          date_accepted: dateAccepted || null,
          comments: comments.trim() || null,
        },
      },
      {
        onSuccess: setResult,
        onError: (err) => {
          setError(apiErrorMessage(err));
          setIssues(fieldErrorsFrom(err)?.application ?? []);
        },
      },
    );
  };

  const close = () => {
    if (result) onAccepted(result);
    setResult(null);
    setLoginEmail('');
    setDateAccepted('');
    setComments('');
    setError(null);
    setIssues([]);
    onClose();
  };

  // ── The result view. Shown until dismissed, because the password is a one-off. ──
  if (result) {
    return (
      <FormDialog
        open={open}
        title="Application accepted"
        submitLabel="Done"
        cancelLabel="Close"
        onSubmit={close}
        onClose={close}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="success">
            <AlertTitle>{result.application.full_name} is now a student</AlertTitle>
            Student ID <strong>{result.student_number}</strong>
            {result.login_email && (
              <>
                {' · '}login <strong>{result.login_email}</strong>
              </>
            )}
          </Alert>

          {result.temporary_password && (
            <Alert severity="warning">
              <AlertTitle>Temporary password — shown once</AlertTitle>
              <Typography
                component="code"
                sx={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700 }}
              >
                {result.temporary_password}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Give it to the student now. It is not stored in readable form and cannot be
                shown again — they will be asked to change it at first sign-in.
              </Typography>
            </Alert>
          )}

          {result.transferred_course_codes.length > 0 && (
            <Alert severity="info">
              <AlertTitle>Credit carried in</AlertTitle>
              {result.transferred_course_codes.join(', ')} — these count toward the award and
              are excluded from the GPA, because a transfer grants credit rather than a grade.
            </Alert>
          )}
        </Stack>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      title="Accept this application"
      submitLabel="Accept and create the student"
      submitting={acceptMut.isPending}
      submitDisabled={blocked.length > 0 || (needsEmail && loginEmail.trim() === '')}
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
            This creates <strong>{application.full_name}</strong>&apos;s student record, their
            portal login and their student ID, and opens their programme history — all in one
            step. The record is built from the application, so nothing here can contradict it.
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

        <TextField
          label="Login email"
          value={loginEmail}
          onChange={(e) => setLoginEmail(e.target.value)}
          fullWidth
          required={needsEmail}
          placeholder={application.email ?? ''}
          helperText={
            needsEmail
              ? 'The application carries no email, so one is needed to issue a login.'
              : `Leave blank to use the applicant's own address (${application.email}).`
          }
        />
        <TextField
          label="Date accepted"
          type="date"
          value={dateAccepted}
          onChange={(e) => setDateAccepted(e.target.value)}
          fullWidth
          InputLabelProps={{ shrink: true }}
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
