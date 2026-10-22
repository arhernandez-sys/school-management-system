import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  useMediaQuery,
  useTheme,
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
 * **D33 — FULL SCREEN ON A PHONE.** Below `sm` the dialog takes the whole viewport. A
 * centred paper on a 390px screen wastes its margins on the one device that has none to
 * spare, and a form long enough to scroll inside a floating box is much harder to use
 * than the same form scrolling as a page. Every one of the ~134 call sites gets this
 * without changing, which is the point of fixing it here rather than per-dialog.
 *
 * Two consequences are deliberate:
 *
 * * The action bar is **sticky to the bottom** when full screen, so Save never scrolls
 *   out of reach on a long form.
 * * `maxWidth` now accepts `lg`, for the sectioned forms that transcribe a paper
 *   document (`StudentFormDialog`). It still has no effect while full screen.
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
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg';
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
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

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
      fullScreen={fullScreen}
      PaperProps={{ component: 'form', onSubmit: handleSubmit, noValidate: true }}
    >
      <DialogTitle sx={{ pr: 2, wordBreak: 'break-word' }}>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {children}
      </DialogContent>
      <DialogActions
        sx={
          fullScreen
            ? {
                // Keeps Save reachable on a long form without scrolling back down.
                position: 'sticky',
                bottom: 0,
                bgcolor: 'background.paper',
                borderTop: 1,
                borderColor: 'divider',
                px: 2,
                py: 1.5,
              }
            : undefined
        }
      >
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
