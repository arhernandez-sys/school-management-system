import { useEffect, useState } from 'react';
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useSetEnrollmentStatus } from '../hooks/useOfferings';
import {
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_NOTATION,
  ENROLLMENT_STATUS_OPTIONS,
  type EnrollmentStatus,
  type RosterEntry,
} from '../types';

export interface CourseStatusDialogProps {
  open: boolean;
  offeringId: string;
  offeringLabel: string;
  entry: RosterEntry | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** What each value actually does, in the Registrar's terms. */
const EXPLAINER: Record<EnrollmentStatus, string> = {
  pre_registered: 'Intends to take the course. The place is not held yet.',
  registered: 'Taking the course for credit, as normal.',
  added: 'Joined after registration closed, during the add/drop window.',
  dropped:
    'Left during add/drop. No credit, no effect on the GPA, and NOTHING on the transcript — that is what separates a drop from a withdrawal.',
  // D45 §19 — one flat "Withdrawn". BAJC chose the blueprint's vocabulary over D35's
  // W/P + W/F pair on 2026-09-08, so the copy can no longer promise a distinction the
  // record does not keep.
  withdrawn:
    'Left the course after add/drop. No credit, and no effect on the GPA — the transcript prints W.',
  completed: 'Sat the course through to a final grade.',
  failed: 'Sat the course and did not pass. Counts in the GPA as a fail.',
  audit:
    'Sitting the course without reading it for credit. Earns no credit and does not affect the GPA.',
};


/**
 * Set one student's COURSE STATUS on one offering (D35 — the client's `coursestatus`).
 *
 * **This is not the Remove action.** Removing un-enrols: the row closes and the student
 * leaves the roster, which says the registration was a mistake. A withdrawal recorded here
 * says they sat the course and left — the row stays, because the transcript has to print
 * the notation against it. Deleting it would erase the very thing being recorded, so the
 * two are deliberately separate controls with separate words.
 *
 * The consequences are spelled out per option rather than left implied, because "audit"
 * and "withdrew" both silently change a student's credits and GPA, and a Registrar
 * choosing one should not have to know the arithmetic to predict that.
 */
export function CourseStatusDialog({
  open,
  offeringId,
  offeringLabel,
  entry,
  onClose,
  onSaved,
}: CourseStatusDialogProps) {
  const mutation = useSetEnrollmentStatus(offeringId);
  const [status, setStatus] = useState<EnrollmentStatus>('registered');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && entry) {
      setStatus(entry.enrollment_status);
      setReason('');
      setError(null);
    }
  }, [open, entry]);

  const unchanged = entry != null && status === entry.enrollment_status;

  const handleSubmit = () => {
    if (!entry) return;
    setError(null);
    mutation.mutate(
      { enrollmentId: entry.enrollment_id, body: { enrollment_status: status, reason: reason.trim() || null } },
      {
        onSuccess: () => {
          onSaved(
            `${entry.student.full_name} is now ${ENROLLMENT_STATUS_LABEL[status].toLowerCase()} on ${offeringLabel}.`,
          );
          onClose();
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const notation = ENROLLMENT_STATUS_NOTATION[status];

  return (
    <FormDialog
      open={open}
      title="Course status"
      submitLabel="Save status"
      submitting={mutation.isPending}
      submitDisabled={unchanged}
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          How {entry?.student.full_name ?? 'this student'} is sitting {offeringLabel}. This
          keeps them on the roster — use <strong>Remove</strong> only if the registration
          itself was a mistake.
        </Typography>

        <TextField
          select
          label="Course status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EnrollmentStatus)}
          fullWidth
        >
          {ENROLLMENT_STATUS_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {ENROLLMENT_STATUS_LABEL[option]}
              {ENROLLMENT_STATUS_NOTATION[option]
                ? ` (${ENROLLMENT_STATUS_NOTATION[option]})`
                : ''}
            </MenuItem>
          ))}
        </TextField>

        <Alert severity={status === 'registered' ? 'info' : 'warning'} variant="outlined">
          {EXPLAINER[status]}
          {notation ? ` The transcript will show ${notation} instead of a grade.` : ''}
        </Alert>

        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          // There is no column for this on the enrolment; it goes to the audit log, which
          // is where every other guarded change in this system keeps its "why".
          helperText="Recorded in the audit log against this change."
        />
      </Stack>
    </FormDialog>
  );
}

export default CourseStatusDialog;
