import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import type { FormEvent, ReactNode } from 'react';

/**
 * FormDialog — modal create/edit scaffold (design-system §5 #8).
 *
 * Promoted from the Phase-6 stub for Settings/Subjects (create/edit subject, user,
 * academic year). Presentational only: the caller renders the form fields as
 * children, owns RHF/local state + the submit handler, and passes submitting/error.
 * The dialog wires the <form> so Enter submits and Esc cancels (unless submitting).
 *
 * Accessibility: focus is trapped by MUI Dialog; a top-level error region uses
 * role="alert"; the submit button is the form's default action.
 */
export interface FormDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Top-level (non-field) error message, e.g. a 409 conflict. */
  error?: string | null;
  submitLabel?: string;
  cancelLabel?: string;
  submitting?: boolean;
  /** Disable submit for client-side invalid state. */
  submitDisabled?: boolean;
  maxWidth?: 'xs' | 'sm' | 'md';
  onSubmit: () => void;
  onClose: () => void;
}

export function FormDialog({
  open,
  title,
  children,
  error,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  submitting = false,
  submitDisabled = false,
  maxWidth = 'sm',
  onSubmit,
  onClose,
}: FormDialogProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting || submitDisabled) return;
    onSubmit();
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth
      PaperProps={{ component: 'form', onSubmit: handleSubmit, noValidate: true }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {children}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant="contained" disabled={submitting || submitDisabled}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default FormDialog;
