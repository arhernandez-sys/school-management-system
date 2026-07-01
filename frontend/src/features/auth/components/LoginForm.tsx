import { useState, useId } from 'react';
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
import SchoolIcon from '@mui/icons-material/School';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '@shared/api/client';
import { ROUTES } from '@shared/constants/routes';
import { strings } from '@i18n/strings';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Login form (ui-design-system §7.1). Centered card, labeled inputs, generic
 * non-enumerating error, Enter submits, button spinner while submitting.
 * Accessibility: <form> with labeled fields, error Alert role="alert".
 */
export function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const errorId = useId();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as LocationState | null)?.from?.pathname ?? ROUTES.dashboard;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(identifier, password);
      if (user.must_change_password) {
        navigate(ROUTES.changePassword, { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      // Non-enumerating message regardless of which field was wrong (FR-AUTH-02).
      if (err instanceof ApiError && err.status === 423) {
        setError(err.message || 'Account temporarily locked. Try again later.');
      } else {
        setError(strings.auth.invalidCredentials);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
      <Card sx={{ width: '100%', maxWidth: 400 }} variant="outlined">
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} alignItems="center" sx={{ mb: 3 }}>
            <SchoolIcon color="primary" sx={{ fontSize: 48 }} aria-hidden />
            <Typography variant="h1" component="h1" sx={{ fontSize: '1.5rem', textAlign: 'center' }}>
              {strings.app.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {strings.auth.signInSubtitle}
            </Typography>
          </Stack>

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {error && (
                <Alert severity="error" role="alert" id={errorId}>
                  {error}
                </Alert>
              )}

              <TextField
                label={strings.auth.identifierLabel}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                fullWidth
                aria-describedby={error ? errorId : undefined}
              />

              <TextField
                label={strings.auth.passwordLabel}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
                aria-describedby={error ? errorId : undefined}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((v) => !v)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={submitting || !identifier || !password}
              >
                {submitting ? 'Signing in…' : strings.auth.signIn}
              </Button>

              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                {strings.auth.forgotPassword}
              </Typography>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default LoginForm;
