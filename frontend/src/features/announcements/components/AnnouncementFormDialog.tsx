import { useEffect, useMemo, useState } from 'react';
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { FormDialog } from '@shared/components';
import type { Role } from '@shared/types/enums';
import { AUDIENCE_LABEL, isoToLocalInput } from '../presentation';
import { useTargetClasses } from '../hooks/useAnnouncements';
import type {
  AnnouncementAudience,
  AnnouncementDetail,
  AnnouncementWritePayload,
} from '../types';

/**
 * Compose / edit dialog (design-system §5 #8). Presentational shell over the shared
 * FormDialog; owns local field state + client-side validation. The audience options
 * are role-gated (UX only — the server re-checks): teachers may only target a class
 * they own; principal/secretary may broadcast to any audience.
 *
 * When audience = class, a section picker (GET /announcements/target-classes) is shown;
 * teachers see only their own sections, so a teacher can never target a class they do
 * not own from this form.
 */

export interface AnnouncementFormValues {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  class_id: string | null;
  /** datetime-local string; '' = no expiry. */
  expires_at_local: string;
}

export interface AnnouncementFormDialogProps {
  open: boolean;
  /** Present => edit mode; null => create. */
  announcement: AnnouncementDetail | null;
  role: Role;
  submitting?: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (payload: AnnouncementWritePayload) => void;
  onClose: () => void;
}

const BROADCAST_AUDIENCES: AnnouncementAudience[] = ['all', 'teachers', 'students'];

function audienceOptionsFor(role: Role): AnnouncementAudience[] {
  if (role === 'teacher') return ['class'];
  // principal / secretary
  return [...BROADCAST_AUDIENCES, 'class'];
}

const emptyValues = (role: Role): AnnouncementFormValues => ({
  title: '',
  body: '',
  audience: role === 'teacher' ? 'class' : 'all',
  class_id: null,
  expires_at_local: '',
});

export function AnnouncementFormDialog({
  open,
  announcement,
  role,
  submitting = false,
  error,
  fieldErrors = {},
  onSubmit,
  onClose,
}: AnnouncementFormDialogProps) {
  const isEdit = Boolean(announcement);
  const [values, setValues] = useState<AnnouncementFormValues>(() => emptyValues(role));

  // Only fetch the section list once the dialog is open (avoids an eager request).
  const classesQuery = useTargetClasses(open);
  const sections = classesQuery.data ?? [];

  const audienceOptions = useMemo(() => audienceOptionsFor(role), [role]);

  // Reset the form whenever the dialog opens or the target announcement changes.
  useEffect(() => {
    if (!open) return;
    if (announcement) {
      setValues({
        title: announcement.title,
        body: announcement.body,
        audience: announcement.audience,
        class_id: announcement.class_ref?.id ?? null,
        expires_at_local: isoToLocalInput(announcement.expires_at),
      });
    } else {
      setValues(emptyValues(role));
    }
  }, [open, announcement, role]);

  const handleAudienceChange = (e: SelectChangeEvent) => {
    const audience = e.target.value as AnnouncementAudience;
    setValues((v) => ({ ...v, audience, class_id: audience === 'class' ? v.class_id : null }));
  };

  const titleTrimmed = values.title.trim();
  const bodyTrimmed = values.body.trim();
  const classRequiredMissing = values.audience === 'class' && !values.class_id;
  const submitDisabled = !titleTrimmed || !bodyTrimmed || classRequiredMissing;

  const handleSubmit = () => {
    if (submitDisabled) return;
    const payload: AnnouncementWritePayload = {
      title: titleTrimmed,
      body: bodyTrimmed,
      audience: values.audience,
      class_id: values.audience === 'class' ? values.class_id : null,
      expires_at:
        values.expires_at_local === '' ? null : new Date(values.expires_at_local).toISOString(),
    };
    onSubmit(payload);
  };

  const fieldError = (name: string): string | undefined => fieldErrors[name]?.[0];

  return (
    <FormDialog
      open={open}
      title={isEdit ? 'Edit announcement' : 'New announcement'}
      submitLabel={isEdit ? 'Save changes' : 'Publish'}
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          label="Title"
          value={values.title}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          required
          fullWidth
          autoFocus
          inputProps={{ maxLength: 120 }}
          error={Boolean(fieldError('title'))}
          helperText={fieldError('title')}
        />

        <TextField
          label="Message"
          value={values.body}
          onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
          required
          fullWidth
          multiline
          minRows={4}
          error={Boolean(fieldError('body'))}
          helperText={fieldError('body')}
        />

        <FormControl fullWidth>
          <InputLabel id="announcement-audience-label">Audience</InputLabel>
          <Select
            labelId="announcement-audience-label"
            label="Audience"
            value={values.audience}
            onChange={handleAudienceChange}
          >
            {audienceOptions.map((a) => (
              <MenuItem key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {values.audience === 'class' && (
          <FormControl fullWidth required error={Boolean(fieldError('class_id'))}>
            <InputLabel id="announcement-class-label">Class</InputLabel>
            <Select
              labelId="announcement-class-label"
              label="Course offering"
              value={values.class_id ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, class_id: e.target.value || null }))}
              disabled={classesQuery.isLoading}
            >
              {sections.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
            {classesQuery.isLoading && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                Loading classes…
              </Typography>
            )}
            {!classesQuery.isLoading && sections.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                You have no classes to post to.
              </Typography>
            )}
            {fieldError('class_id') && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                {fieldError('class_id')}
              </Typography>
            )}
          </FormControl>
        )}

        <TextField
          label="Expires (optional)"
          type="datetime-local"
          value={values.expires_at_local}
          onChange={(e) => setValues((v) => ({ ...v, expires_at_local: e.target.value }))}
          fullWidth
          InputLabelProps={{ shrink: true }}
          helperText={fieldError('expires_at') ?? 'Leave blank to keep it visible indefinitely.'}
          error={Boolean(fieldError('expires_at'))}
        />
      </Stack>
    </FormDialog>
  );
}

export default AnnouncementFormDialog;
