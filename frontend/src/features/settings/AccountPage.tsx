import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  Box,
  Button,
  Divider,
  Link as MuiLink,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import { PageHeader, LoadingState, ErrorState, RoleChip } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import type { AccountUpdateRequest } from '@shared/api/generated/model';
import { useAccount, useUpdateAccount } from './hooks/useSettings';

/**
 * My account & preferences (api-spec §5.11 GET/PATCH /settings/account) — every role.
 *
 * Editable per the generated contract: full name + preferences (locale, theme,
 * date_format, default_page_size). Email + role are read-only (identity is admin-
 * managed). Password change is the separate forced-change flow (PATCH /auth/me/password),
 * linked out to /login/change-password — not rebuilt here.
 *
 * `default_page_size` is validated client-side to 5..200 (the server 422s outside that
 * range); server field errors map back onto the matching inputs.
 */

const LOCALE_OPTIONS = [{ value: 'en', label: 'English' }];
const THEME_OPTIONS = [{ value: 'light', label: 'Light' }]; // D20: light-only for v1
const DATE_FORMAT_OPTIONS = [
  { value: 'YYYY-MM-DD', label: '2026-06-30 (ISO)' },
  { value: 'DD/MM/YYYY', label: '30/06/2026 (day first)' },
  { value: 'MM/DD/YYYY', label: '06/30/2026 (month first)' },
];

const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 200;

interface AccountFormValues {
  full_name: string;
  locale: string;
  theme: string;
  date_format: string;
  default_page_size: number;
}

export function AccountPage() {
  const query = useAccount();
  const updateMut = useUpdateAccount();

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<AccountFormValues>({
    defaultValues: {
      full_name: '',
      locale: 'en',
      theme: 'light',
      date_format: 'YYYY-MM-DD',
      default_page_size: 25,
    },
  });

  const account = query.data;

  // Hydrate the form once the account loads (and after a successful save re-fetch).
  useEffect(() => {
    if (account) {
      reset({
        full_name: account.full_name,
        locale: account.preferences.locale || 'en',
        theme: account.preferences.theme || 'light',
        date_format: account.preferences.date_format || 'YYYY-MM-DD',
        default_page_size: account.preferences.default_page_size ?? 25,
      });
    }
  }, [account, reset]);

  const onSubmit = (values: AccountFormValues) => {
    const body: AccountUpdateRequest = {
      full_name: values.full_name.trim(),
      preferences: {
        locale: values.locale,
        theme: values.theme,
        date_format: values.date_format,
        default_page_size: values.default_page_size,
      },
    };
    updateMut.mutate(
      { data: body },
      {
        onError: (err) => {
          // Map server field errors back onto their inputs; keep the form open.
          const fields = fieldErrorsFrom(err);
          if (fields) {
            for (const [name, msgs] of Object.entries(fields)) {
              // Preference fields are nested under `preferences.*` on the wire.
              const key = name.replace(/^preferences\./, '') as keyof AccountFormValues;
              setError(key, { type: 'server', message: msgs.join(' ') });
            }
          }
        },
      },
    );
  };

  const resetToAccount = () => {
    if (!account) return;
    reset({
      full_name: account.full_name,
      locale: account.preferences.locale || 'en',
      theme: account.preferences.theme || 'light',
      date_format: account.preferences.date_format || 'YYYY-MM-DD',
      default_page_size: account.preferences.default_page_size ?? 25,
    });
  };

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="My account" subtitle="Your contact details and preferences." />
        <LoadingState variant="form" />
      </>
    );
  }

  if (query.isError || !account) {
    return (
      <>
        <PageHeader title="My account" subtitle="Your contact details and preferences." />
        <ErrorState onRetry={() => void query.refetch()} />
      </>
    );
  }

  const submitError = updateMut.isError ? apiErrorMessage(updateMut.error) : null;

  return (
    <>
      <PageHeader title="My account" subtitle="Your contact details and preferences." />

      <Paper
        variant="outlined"
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        sx={{ p: 3, maxWidth: 640 }}
      >
        <Stack spacing={3}>
          {submitError && (
            <Alert severity="error" role="alert">
              {submitError}
            </Alert>
          )}

          {/* ── Identity ─────────────────────────────────────────────────────── */}
          <Box>
            <Typography variant="h4" component="h2" sx={{ mb: 2 }}>
              Profile
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Email"
                value={account.email}
                fullWidth
                disabled
                helperText="Managed by your administrator."
              />
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ mb: 0.5 }}
                >
                  Role
                </Typography>
                <RoleChip role={account.role} />
              </Box>
              <Controller
                name="full_name"
                control={control}
                rules={{ required: 'Full name is required.' }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Full name"
                    fullWidth
                    required
                    inputProps={{ maxLength: 120, 'aria-required': true }}
                    error={Boolean(errors.full_name)}
                    helperText={errors.full_name?.message ?? 'Required'}
                  />
                )}
              />
            </Stack>
          </Box>

          <Divider />

          {/* ── Preferences ──────────────────────────────────────────────────── */}
          <Box>
            <Typography variant="h4" component="h2" sx={{ mb: 2 }}>
              Preferences
            </Typography>
            <Stack spacing={2}>
              <Controller
                name="locale"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Language" fullWidth>
                    {LOCALE_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="theme"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Theme"
                    fullWidth
                    helperText="Dark mode is planned for a future release."
                  >
                    {THEME_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="date_format"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Date format" fullWidth>
                    {DATE_FORMAT_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="default_page_size"
                control={control}
                rules={{
                  required: 'Enter a page size.',
                  min: { value: MIN_PAGE_SIZE, message: `Must be at least ${MIN_PAGE_SIZE}.` },
                  max: { value: MAX_PAGE_SIZE, message: `Must be at most ${MAX_PAGE_SIZE}.` },
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Rows per page (default)"
                    type="number"
                    fullWidth
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    inputProps={{ min: MIN_PAGE_SIZE, max: MAX_PAGE_SIZE, step: 1 }}
                    error={Boolean(errors.default_page_size)}
                    helperText={
                      errors.default_page_size?.message ??
                      `Between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`
                    }
                  />
                )}
              />
            </Stack>
          </Box>

          <Divider />

          {/* ── Security ─────────────────────────────────────────────────────── */}
          <Box>
            <Typography variant="h4" component="h2" sx={{ mb: 1 }}>
              Security
            </Typography>
            <MuiLink
              component={RouterLink}
              to={ROUTES.changePassword}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              <LockResetIcon fontSize="small" aria-hidden />
              Change password
            </MuiLink>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button
              type="button"
              onClick={resetToAccount}
              disabled={!isDirty || updateMut.isPending}
            >
              Reset
            </Button>
            <Button type="submit" variant="contained" disabled={!isDirty || updateMut.isPending}>
              {updateMut.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Snackbar
        open={updateMut.isSuccess && !isDirty}
        autoHideDuration={4000}
        message="Account updated"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}

export default AccountPage;
