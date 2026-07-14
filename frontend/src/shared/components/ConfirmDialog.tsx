import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import type { ReactNode } from 'react';

/**
 * ConfirmDialog — destructive/irreversible-action gate (design-system §5 #4).
 *
 * Promoted from the Phase-6 stub for Settings/Subjects (retire/delete subject,
 * archive year, reset password). The caller owns the async action and its
 * pending/error state; this component just confirms intent.
 *
 * Accessibility: MUI Dialog traps focus + labels the title/description via
 * aria-labelledby/aria-describedby automatically; the confirm button receives
 * initial focus only when non-destructive (destructive defaults focus to Cancel).
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Extra warning surfaced as an Alert (e.g. "this freezes the year"). */
  warning?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visually emphasize the confirm action as destructive. */
  destructive?: boolean;
  /** Disables the confirm button + shows a pending label. */
  pending?: boolean;
  /** Inline error from the failed action (e.g. a 409 conflict message). */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={pending ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {description && (
          <DialogContentText sx={{ mb: warning || error ? 2 : 0 }}>{description}</DialogContentText>
        )}
        {warning && (
          <Alert severity="warning" sx={{ mb: error ? 2 : 0 }}>
            {warning}
          </Alert>
        )}
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={pending} autoFocus={destructive}>
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          disabled={pending}
          autoFocus={!destructive}
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
