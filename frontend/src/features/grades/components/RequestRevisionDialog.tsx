import { useEffect, useState } from 'react';
import { Alert, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { useRequestGradeRevision } from '../hooks/useRevisions';

/**
 * The Lecturer asks the Dean to revise one grade (D30 §D7, brief §20).
 *
 * **Requesting writes no grade**, which is why this is reachable after the grade-submission
 * deadline while the save bar is not: asking the Dean to look at something is exactly what
 * should still be possible once the window has shut. The dialog says so, because otherwise
 * a Lecturer facing a locked gradebook has no reason to think this route is open.
 *
 * The reason is required — brief §20 asks for a description, and the Dean needs something to
 * rule on. Everything else the server validates (within `max_score`, different from the
 * current mark, no other request already pending), and its messages are surfaced verbatim
 * rather than re-checked here.
 */
export interface RequestRevisionDialogProps {
  open: boolean;
  assessmentId: string;
  assessmentTitle: string;
  maxScore: number;
  student: { id: string; full_name: string } | null;
  /** The mark the student holds now — shown so the Dean's "from → to" is unambiguous. */
  currentScore: number | null;
  /** True when the term's grade window has closed; changes the explanatory copy only. */
  windowClosed?: boolean;
  onClose: () => void;
}

export function RequestRevisionDialog({
  open,
  assessmentId,
  assessmentTitle,
  maxScore,
  student,
  currentScore,
  windowClosed = false,
  onClose,
}: RequestRevisionDialogProps) {
  const requestMut = useRequestGradeRevision();
  const [proposed, setProposed] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    setProposed('');
    setReason('');
    setError(null);
    setFieldErrors({});
  }, [open, student?.id]);

  const proposedNumber = Number(proposed);
  const proposedValid =
    proposed.trim() !== '' &&
    !Number.isNaN(proposedNumber) &&
    proposedNumber >= 0 &&
    proposedNumber <= maxScore &&
    proposedNumber !== currentScore;

  const submit = () => {
    if (!student) return;
    setError(null);
    setFieldErrors({});
    requestMut.mutate(
      {
        assessmentId,
        body: {
          student_id: student.id,
          reason: reason.trim(),
          proposed_score: proposedNumber,
        },
      },
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
      title="Request a grade revision"
      submitLabel="Send to the Dean"
      submitting={requestMut.isPending}
      submitDisabled={!student || !proposedValid || reason.trim().length === 0}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Alert severity="info">
          {windowClosed
            ? 'Grade submission has closed for this term, so the mark cannot be edited directly — but a revision can still be requested. The Dean decides, and an approval takes effect even after the deadline.'
            : 'The Dean decides. Nothing changes until they approve it, and the original mark is kept either way.'}
        </Alert>

        <Typography variant="body2">
          <strong>{student?.full_name ?? '—'}</strong> · {assessmentTitle} · currently{' '}
          <strong>{currentScore ?? '—'}</strong> of {maxScore}
        </Typography>

        <TextField
          label="Proposed score"
          type="number"
          value={proposed}
          onChange={(e) => setProposed(e.target.value)}
          required
          fullWidth
          autoFocus
          inputProps={{ min: 0, max: maxScore, step: 0.5 }}
          error={Boolean(fieldErrors.proposed_score) || (proposed.trim() !== '' && !proposedValid)}
          helperText={
            fieldErrors.proposed_score?.join(' ') ??
            (proposed.trim() !== '' && proposedNumber === currentScore
              ? 'Must differ from the current score.'
              : `Between 0 and ${maxScore}.`)
          }
        />

        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          fullWidth
          multiline
          minRows={3}
          placeholder="e.g. The essay section was added up wrong — 18 marks were omitted."
          error={Boolean(fieldErrors.reason)}
          helperText={
            fieldErrors.reason?.join(' ') ??
            'The Dean sees this. Say what changed and why the original was wrong.'
          }
        />
      </Stack>
    </FormDialog>
  );
}

export default RequestRevisionDialog;
