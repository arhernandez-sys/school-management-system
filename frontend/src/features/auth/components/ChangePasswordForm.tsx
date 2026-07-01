import { useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import LockResetIcon from '@mui/icons-material/LockReset';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { changePassword } from '../api/authApi';
import { ApiError } from '@shared/api/client';
import { ROUTES } from '@shared/constants/routes';
import type { ChangePasswordRequest } from '@shared/api/generated/model';

/**
 * Forced / self-service password change (api-spec §2.3, FR-AUTH-09).
 *
 * Reached after login when `must_change_password` is true (the only permitted write
 * in that state) and reusable for a voluntary change later. In the forced flow the
 * backend accepts `current_password` omitted, so we hide that field; otherwise it is
 * required. On success the backend clears `must_change_password` and revokes the
 * user's other sessions; we re-fetch /auth/me (clears the flag client-side) and route
 * on to the dashboard.
 *
 * Accessibility: labeled fields, an `role="alert"` error region, password show/hide
 * toggles with state-describing labels, client-side confirm-match before submit.
 */
export function ChangePasswordForm() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const errorId = useId();

  const forced = user?.must_change_password ?? false;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    const body: ChangePasswordRequest = { new_password: newPassword };
    if (!forced) body.current_password = currentPassword;

    setSubmitting(true);
    try {
      await changePassword(body);
      // Clears must_change_password client-side and re-establishes the session view.
      await refreshUser();
      navigate(ROUTES.dashboard, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) setFieldErrors(err.fields);
        setError(err.message || 'Could not change your password. Please try again.');
      } else {
        setError('Could not change your password. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const newPasswordErrors = fieldErrors.new_password;
  const currentPasswordErrors = fieldErrors.current_password;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }} variant="outlined">
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} alignItems="center" sx={{ mb: 3 }}>
            <LockResetIcon color="primary" sx={{ fontSize: 48 }} aria-hidden />
            <Typography variant="h1" component="h1" sx={{ fontSize: '1.5rem', textAlign: 'center' }}>
              Change your password
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {forced
                ? 'Your administrator requires a password change before continuing.'
                : 'Choose a new password for your account.'}
            </Typography>
          </Stack>

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {error && (
                <Alert severity="error" role="alert" id={errorId}>
                  {error}
                </Alert>
              )}

              {!forced && (
                <TextField
                  label="Current password"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  fullWidth
                  error={Boolean(currentPasswordErrors)}
                  helperText={currentPasswordErrors?.join(' ')}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
                          onClick={() => setShowCurrent((v) => !v)}
                          edge="end"
                        >
                          {showCurrent ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              )}

              <TextField
                label="New password"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
                fullWidth
                error={Boolean(newPasswordErrors)}
                helperText={newPasswordErrors?.join(' ')}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showNew ? 'Hide new password' : 'Show new password'}
                        onClick={() => setShowNew((v) => !v)}
                        edge="end"
                      >
                        {showNew ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <TextField
                label="Confirm new password"
                type={showNew ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                fullWidth
                error={mismatch}
                helperText={mismatch ? 'Passwords do not match.' : undefined}
              />

              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={submitting || !newPassword || !confirmPassword || mismatch}
              >
                {submitting ? 'Saving…' : 'Update password'}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default ChangePasswordForm;
