import { useState } from 'react';
import { Alert, AlertTitle, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { FormDialog, DateField } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useEnrollApplication } from '../hooks/useAdmissions';
import type { ApplicationDetail, EnrollResponse } from '../types';

/**
 * Enrolment (D46) — the accepted applicant registers, and THIS is what creates the student:
 * the student record (built from Sections A–E), the student ID and the programme history.
 *
 * **The login is optional** (client, Oct 2026). Leave it blank and the student is enrolled
 * without one; Settings → Users creates the login later and links it to this student. A
 * student login can only be linked to an existing student profile, so it can never be
 * issued to someone who is only accepted.
 *
 * ⚠️ The login email is the address the COLLEGE issues, never the applicant's personal one.
 * There is no fallback to it (D39).
 *
 * The temporary password comes back **once**. It is not re-fetchable, so the dialog stays
 * open on the result until the Registrar dismisses it rather than closing over the one
 * chance to write it down.
 */
export interface EnrollDialogProps {
  open: boolean;
  application: ApplicationDetail;
  onClose: () => void;
  /** Called after a successful enrolment, once the result has been dismissed. */
  onEnrolled: (result: EnrollResponse) => void;
}

/**
 * A small copy-to-clipboard button. The Registrar hands the student their ID, login and
 * one-time password, and retyping a generated password is where transcription errors
 * come from. Same behaviour as `TempPasswordDialog`'s copy button.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context); the value is still selectable.
    }
  };

  return (
    <Tooltip title={copied ? 'Copied' : `Copy ${label}`}>
      <IconButton size="small" onClick={copy} aria-label={`Copy ${label}`} sx={{ ml: 0.5 }}>
        {copied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  );
}

export function EnrollDialog({ open, application, onClose, onEnrolled }: EnrollDialogProps) {
  const enrollMut = useEnrollApplication();
  const [enrollmentDate, setEnrollmentDate] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrollResponse | null>(null);

  const submit = () => {
    setError(null);
    enrollMut.mutate(
      {
        id: application.id,
        body: {
          enrollment_date: enrollmentDate || null,
          login_email: loginEmail.trim() || null,
          comments: comments.trim() || null,
        },
      },
      {
        onSuccess: setResult,
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const close = () => {
    if (result) onEnrolled(result);
    setResult(null);
    setEnrollmentDate('');
    setLoginEmail('');
    setComments('');
    setError(null);
    onClose();
  };

  // ── The result view. Shown until dismissed, because the password is a one-off. ──
  if (result) {
    return (
      <FormDialog
        open={open}
        title="Student enrolled"
        submitLabel="Done"
        cancelLabel="Close"
        onSubmit={close}
        onClose={close}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="success">
            <AlertTitle>{result.application.full_name} is now a student</AlertTitle>
            <Stack spacing={0.25}>
              <span>
                Student ID <strong>{result.student_number}</strong>
                <CopyButton value={result.student_number} label="student ID" />
              </span>
              {result.login_email && (
                <span>
                  Login <strong>{result.login_email}</strong>
                  <CopyButton value={result.login_email} label="login email" />
                </span>
              )}
            </Stack>
          </Alert>

          {result.temporary_password && (
            <Alert severity="warning">
              <AlertTitle>Temporary password — shown once</AlertTitle>
              <Stack direction="row" sx={{ alignItems: 'center' }}>
                <Typography
                  component="code"
                  sx={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700 }}
                >
                  {result.temporary_password}
                </Typography>
                <CopyButton value={result.temporary_password} label="temporary password" />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Give it to the student now. It is not stored in readable form and cannot be shown
                again — they will be asked to change it at first sign-in.
              </Typography>
            </Alert>
          )}

          {!result.login_email && (
            <Alert severity="info">
              <AlertTitle>No login yet</AlertTitle>
              When the student needs portal access, create a user in{' '}
              <strong>Settings → Users</strong> with the Student role and link it to{' '}
              {result.student_number}.
            </Alert>
          )}

          {result.transferred_course_codes.length > 0 && (
            <Alert severity="info">
              <AlertTitle>Credit carried in</AlertTitle>
              {result.transferred_course_codes.join(', ')} — these count toward the award and are
              excluded from the GPA, because a transfer grants credit rather than a grade.
            </Alert>
          )}
        </Stack>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      title="Enrol this student"
      submitLabel="Enrol and create the student"
      submitting={enrollMut.isPending}
      error={error}
      maxWidth="sm"
      onClose={close}
      onSubmit={submit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Alert severity="info">
          This creates <strong>{application.full_name}</strong>&apos;s student record and student ID
          and opens their programme history. The record is built from the application, so nothing
          here can contradict it.
        </Alert>

        <DateField
          label="Enrollment date"
          value={enrollmentDate}
          onChange={setEnrollmentDate}
          fullWidth
          helperText="Defaults to today. The student ID is numbered from this date's year."
        />
        <TextField
          label="Login email the college is issuing (optional)"
          value={loginEmail}
          onChange={(e) => setLoginEmail(e.target.value)}
          fullWidth
          type="email"
          placeholder="student@bajc.edu.bz"
          helperText="Leave blank to enrol without a login. You can create one later in Settings → Users and link it to this student."
        />
        {application.email && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            {/* Shown for reference, never used as the login: a contact address is not a
                credential (D39). */}
            Their personal address, for contact only: {application.email}
          </Typography>
        )}
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

export default EnrollDialog;
