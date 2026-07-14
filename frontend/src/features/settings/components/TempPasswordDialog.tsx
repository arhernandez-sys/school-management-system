import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

/**
 * One-time temporary-password reveal (api-spec §11 / §2). The backend returns a
 * temporary password ONCE — on user creation (when generated) or on an admin reset.
 * This dialog surfaces it clearly with a copy button and a warning that it will not be
 * shown again. It never persists the value.
 */
export interface TempPasswordDialogProps {
  open: boolean;
  password: string | null;
  /** Name/email of the account this belongs to, for context. */
  subject?: string;
  onClose: () => void;
}

export function TempPasswordDialog({ open, password, subject, onClose }: TempPasswordDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context); the value is still selectable.
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Temporary password</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {subject ? `A temporary password for ${subject} has been set. ` : ''}
          Share it securely with the user. They will be required to change it at first sign-in.
        </DialogContentText>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            value={password ?? ''}
            fullWidth
            InputProps={{ readOnly: true }}
            inputProps={{ 'aria-label': 'Temporary password' }}
          />
          <Tooltip title={copied ? 'Copied' : 'Copy'}>
            <IconButton onClick={handleCopy} aria-label="Copy temporary password">
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box sx={{ mt: 2 }}>
          <Alert severity="warning">This password will not be shown again. Copy it now.</Alert>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TempPasswordDialog;
