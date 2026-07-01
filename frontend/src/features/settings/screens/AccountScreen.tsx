import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import { useNavigate } from 'react-router-dom';
import { PageHeader, LoadingState, ErrorState, RoleChip } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useAccount, useUpdateAccount } from '../hooks/useSettings';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';

const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];
const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];
const DATE_FORMAT_OPTIONS = [
  { value: 'YYYY-MM-DD', label: '2026-06-30 (ISO)' },
  { value: 'MM/DD/YYYY', label: '06/30/2026' },
  { value: 'DD/MM/YYYY', label: '30/06/2026' },
];

/**
 * Account & preferences (api-spec §11, FR-SET-05). Every role edits their own contact
 * name + display preferences (locale / theme / date format / default page size 5..200).
 * Password change is a separate, security-sensitive flow — we link to the existing
 * ChangePassword screen (PATCH /auth/me/password) rather than duplicate it here.
 */
export function AccountScreen() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const query = useAccount();
  const updateMut = useUpdateAccount();

  const [fullName, setFullName] = useState('');
  const [locale, setLocale] = useState('en');
  const [theme, setTheme] = useState('light');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) {
      setFullName(query.data.full_name ?? '');
      setLocale(query.data.preferences.locale ?? 'en');
      setTheme(query.data.preferences.theme ?? 'light');
      setDateFormat(query.data.preferences.date_format ?? 'YYYY-MM-DD');
      setPageSize(query.data.preferences.default_page_size ?? 25);
    }
  }, [query.data]);

  if (query.isLoading) return <LoadingState variant="form" rows={6} />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const pageSizeInvalid = pageSize < 5 || pageSize > 200;

  const handleSave = () => {
    setError(null);
    setFieldErrors({});
    updateMut.mutate(
      {
        data: {
          full_name: fullName.trim() || null,
          preferences: {
            locale,
            theme,
            date_format: dateFormat,
            default_page_size: pageSize,
          },
        },
      },
      {
        onSuccess: async () => {
          setSaved(true);
          // Preferences feed the shell/theme; refresh the current user snapshot.
          await refreshUser();
        },
        onError: (err) => {
          setError(apiErrorMessage(err));
          const fields = fieldErrorsFrom(err);
          if (fields) setFieldErrors(fields);
        },
      },
    );
  };

  return (
    <>
      <PageHeader title="My account" subtitle="Your profile and display preferences." />

      <Stack spacing={3} sx={{ maxWidth: 560 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h4" component="h2">
              Profile
            </Typography>
            <RoleChip role={query.data.role} />
          </Stack>
          {error && (
            <Alert severity="error" role="alert" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2}>
            <TextField label="Email" value={query.data.email} fullWidth disabled />
            <TextField
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.full_name)}
              helperText={fieldErrors.full_name?.join(' ')}
            />
          </Stack>

          <Divider sx={{ my: 3 }} />

          <Typography variant="h4" component="h2" gutterBottom>
            Preferences
          </Typography>
          <Stack spacing={2}>
            <TextField
              select
              label="Language"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              fullWidth
            >
              {LOCALE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              fullWidth
              helperText="Dark mode is planned for a future release."
            >
              {THEME_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Date format"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              fullWidth
            >
              {DATE_FORMAT_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Rows per page (default)"
              type="number"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              inputProps={{ min: 5, max: 200 }}
              sx={{ width: 220 }}
              error={pageSizeInvalid}
              helperText={pageSizeInvalid ? 'Choose a value between 5 and 200.' : undefined}
            />
            <Box>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={updateMut.isPending || pageSizeInvalid}
              >
                {updateMut.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h4" component="h2" gutterBottom>
            Security
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Change the password you use to sign in.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<LockResetIcon />}
            onClick={() => navigate(ROUTES.changePassword)}
          >
            Change password
          </Button>
        </Paper>
      </Stack>

      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message="Preferences saved"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}

export default AccountScreen;
