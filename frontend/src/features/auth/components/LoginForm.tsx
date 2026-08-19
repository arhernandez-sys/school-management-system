import { useState, useId } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '@shared/api/client';
import { ROUTES } from '@shared/constants/routes';
import { strings } from '@i18n/strings';
import { ROLE_OPTIONS } from '@shared/auth/roleLabels';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Demo mode only (VITE_ENABLE_MOCKS): the MSW auth handler keys the signed-in role off
 * the identifier (`principal` | `secretary` | `teacher` | `student`, any password) and
 * silently falls back to `principal` for anything else. These one-click buttons make
 * the four roles discoverable so a reviewer can actually enter each one instead of
 * guessing the magic username. No effect in real-backend mode (the panel is hidden).
 */
const DEMO_MODE = import.meta.env.VITE_ENABLE_MOCKS === 'true';
/**
 * `id` is the literal text typed into the identifier box — the MSW handler keys the
 * signed-in role off it, so it MUST stay the wire value. Only the button label is the
 * tertiary term (D30), and it comes from the one shared role-label source.
 */
const DEMO_ROLES = ROLE_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label }));

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

  const submitCredentials = async (id: string, pw: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(id, pw);
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submitCredentials(identifier, password);
  };

  // Demo one-click sign-in: the mock backend accepts any password for these roles.
  const handleDemoLogin = (role: string) => void submitCredentials(role, 'demo-password');

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
            <Box
              component="img"
              src="/logo.jpeg"
              alt={strings.app.schoolName}
              sx={{ width: 88, height: 88, objectFit: 'contain' }}
            />
            <Typography variant="h1" component="h1" sx={{ fontSize: '1.75rem', textAlign: 'center' }}>
              {strings.app.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {strings.app.fullName}
            </Typography>
            <Typography
              variant="subtitle2"
              color="primary"
              sx={{ textAlign: 'center', fontWeight: 600 }}
            >
              {strings.app.schoolName}
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

          {DEMO_MODE && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 2 }}>
                <Chip label="Demo — sign in as" size="small" />
              </Divider>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 1,
                }}
              >
                {DEMO_ROLES.map((role) => (
                  <Button
                    key={role.id}
                    variant="outlined"
                    size="small"
                    disabled={submitting}
                    onClick={() => handleDemoLogin(role.id)}
                  >
                    {role.label}
                  </Button>
                ))}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}
              >
                No backend — data is mocked. Any password works for these roles.
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

export default LoginForm;
