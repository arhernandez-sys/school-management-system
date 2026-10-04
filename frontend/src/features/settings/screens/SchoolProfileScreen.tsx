import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import UploadIcon from '@mui/icons-material/Upload';
import { PageHeader, LoadingState, ErrorState } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useSchoolProfile, useUpdateSchoolProfile } from '../hooks/useSettings';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';

/**
 * School profile / branding (api-spec §11, FR-SET). Principal edits; others view.
 *
 * LOGO UPLOAD IS BLOCKED (progress-tracker OQ-DB5): the backend accepts the request
 * shape but stores nothing and returns logo_url=null until the Supabase bucket +
 * anon key are provisioned. We render the upload control DISABLED with an explicit
 * "not yet configured" affordance rather than shipping a half-working uploader.
 */
export function SchoolProfileScreen() {
  const { user } = useAuth();
  const canEdit = user ? user.role === 'principal' : false;

  const query = useSchoolProfile();
  const updateMut = useUpdateSchoolProfile();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  // D39 (Meeting #2 item 6). Held as a STRING so the field can be genuinely empty:
  // empty means "never expires", and a numeric state would have to pick some number to
  // stand for that. `0` is a real, different value — access ends on graduation day.
  const [gradAccessDays, setGradAccessDays] = useState('');
  // D45 §23 — the attendance warning floor. Blueprint §57: institutional rules belong in
  // configuration, not in source. It was a constant in the backend until now.
  const [attendanceFloor, setAttendanceFloor] = useState('80');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) {
      setName(query.data.name ?? '');
      setAddress(query.data.address ?? '');
      setContactEmail(query.data.contact_email ?? '');
      setContactPhone(query.data.contact_phone ?? '');
      setGradAccessDays(
        query.data.post_graduation_access_days == null
          ? ''
          : String(query.data.post_graduation_access_days),
      );
      setAttendanceFloor(String(query.data.attendance_alert_threshold ?? 80));
    }
  }, [query.data]);

  if (query.isLoading) return <LoadingState variant="form" rows={5} />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const handleSave = () => {
    setFormError(null);
    setFieldErrors({});
    updateMut.mutate(
      {
        data: {
          name: name.trim(),
          address: address.trim() || null,
          contact_email: contactEmail.trim() || null,
          contact_phone: contactPhone.trim() || null,
          // Empty box -> null -> never expires. `Number('')` is 0, which would silently
          // mean the opposite (access ends the day they graduate), so the blank is
          // checked before the conversion rather than relying on it.
          post_graduation_access_days:
            gradAccessDays.trim() === '' ? null : Number(gradAccessDays),
          // D45 §23. NOT nullable, unlike the days above: a college with no threshold
          // does not want an alerts screen that flags nobody, it wants the number it has
          // always used. A blank box falls back to the blueprint's own example of 80
          // rather than to 0, which would flag every student who ever missed a class.
          attendance_alert_threshold:
            attendanceFloor.trim() === '' ? 80 : Number(attendanceFloor),
        },
      },
      {
        onSuccess: () => setSaved(true),
        onError: (err) => {
          setFormError(apiErrorMessage(err));
          const fields = fieldErrorsFrom(err);
          if (fields) setFieldErrors(fields);
        },
      },
    );
  };

  return (
    <>
      <PageHeader title="School profile" subtitle="Your school's identity and contact information." />

      <Stack spacing={3} sx={{ maxWidth: 640 }}>
        {/* Branding / logo — BLOCKED (OQ-DB5) */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h4" component="h2" gutterBottom>
              Branding
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Avatar
                src={query.data.logo_url ?? undefined}
                variant="rounded"
                sx={{ width: 64, height: 64, bgcolor: 'primary.main' }}
              >
                <SchoolIcon />
              </Avatar>
              <Box>
                <Button variant="outlined" startIcon={<UploadIcon />} disabled>
                  Upload logo
                </Button>
              </Box>
            </Stack>
            <Alert severity="info">
              Logo upload is not yet configured. File storage for the school logo will be enabled
              in a later release; the control is disabled until then.
            </Alert>
          </CardContent>
        </Card>

        {/* Identity + contact */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h4" component="h2" gutterBottom>
            Details
          </Typography>
          {formError && (
            <Alert severity="error" role="alert" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          )}
          <Stack spacing={2}>
            <TextField
              label="School name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
              disabled={!canEdit}
              inputProps={{ maxLength: 200 }}
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name?.join(' ')}
            />
            <TextField
              label="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              disabled={!canEdit}
              error={Boolean(fieldErrors.address)}
              helperText={fieldErrors.address?.join(' ')}
            />
            <TextField
              label="Contact email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              fullWidth
              disabled={!canEdit}
              error={Boolean(fieldErrors.contact_email)}
              helperText={fieldErrors.contact_email?.join(' ')}
            />
            <TextField
              label="Contact phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              fullWidth
              disabled={!canEdit}
              error={Boolean(fieldErrors.contact_phone)}
              helperText={fieldErrors.contact_phone?.join(' ')}
            />
            {/* D39 — Meeting #2 item 6: "Set Availability of Grades/online access to
                students after graduation, for a period, recommended time is 3 months."
                A policy, not identity, but it is operator-set and this is the screen the
                operator has. */}
            <TextField
              label="Graduate access (days)"
              type="number"
              value={gradAccessDays}
              onChange={(e) => setGradAccessDays(e.target.value)}
              fullWidth
              disabled={!canEdit}
              slotProps={{ htmlInput: { min: 0, max: 3650 } }}
              error={Boolean(fieldErrors.post_graduation_access_days)}
              helperText={
                fieldErrors.post_graduation_access_days?.join(' ') ??
                'How long a graduate keeps their grades and attendance after graduating. ' +
                  'Leave blank for no expiry; 90 is three months. Staff are never affected.'
              }
            />
            {/* D45 §23 — "Configurable alerts should allow the college to define
                thresholds. Example: Attendance below 80% = Warning." */}
            <TextField
              label="Attendance warning threshold (%)"
              type="number"
              value={attendanceFloor}
              onChange={(e) => setAttendanceFloor(e.target.value)}
              fullWidth
              disabled={!canEdit}
              slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
              error={Boolean(fieldErrors.attendance_alert_threshold)}
              helperText={
                fieldErrors.attendance_alert_threshold?.join(' ') ??
                'A student or class at or below this attendance percentage is flagged on ' +
                  'the alerts screen and the Dean dashboard. BAJC policy; 80 is the default.'
              }
            />
            {canEdit && (
              <Box>
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={updateMut.isPending || name.trim().length === 0}
                >
                  {updateMut.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </Box>
            )}
          </Stack>
        </Paper>
      </Stack>

      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message="School profile saved"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}

export default SchoolProfileScreen;
