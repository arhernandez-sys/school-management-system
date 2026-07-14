import { useEffect, useState } from 'react';
import {
  Box,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { FormDialog } from '@shared/components';
import {
  CATEGORY_META,
  CATEGORY_OPTIONS,
  VISIBILITY_META,
  VISIBILITY_OPTIONS,
} from '../utils';
import type {
  CalendarEvent,
  EventCategory,
  EventVisibility,
  EventWritePayload,
} from '../types';

export interface EventFormDialogProps {
  open: boolean;
  /** Null → create; an event → edit. */
  event: CalendarEvent | null;
  /** Preselected date when creating from a day cell (YYYY-MM-DD). */
  initialDate?: string | null;
  submitting: boolean;
  error: string | null;
  fieldErrors: Record<string, string[]>;
  onSubmit: (payload: EventWritePayload) => void;
  onClose: () => void;
}

interface FormState {
  title: string;
  category: EventCategory;
  visibility: EventVisibility;
  all_day: boolean;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
}

function initialState(event: CalendarEvent | null, initialDate?: string | null): FormState {
  if (event) {
    return {
      title: event.title,
      category: event.category,
      visibility: event.visibility,
      all_day: event.all_day,
      start_date: event.start_date,
      end_date: event.end_date ?? '',
      start_time: event.start_time ?? '',
      end_time: event.end_time ?? '',
      location: event.location ?? '',
      description: event.description ?? '',
    };
  }
  return {
    title: '',
    category: 'activity',
    visibility: 'global',
    all_day: true,
    start_date: initialDate ?? '',
    end_date: '',
    start_time: '',
    end_time: '',
    location: '',
    description: '',
  };
}

/** Create/edit a calendar event. Presentational; parent owns the mutation + errors. */
export function EventFormDialog({
  open,
  event,
  initialDate,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: EventFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(event, initialDate));

  // Re-seed whenever the dialog opens for a different event/day.
  useEffect(() => {
    if (open) setForm(initialState(event, initialDate));
  }, [open, event, initialDate]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  const handleSubmit = () => {
    onSubmit({
      title: form.title.trim(),
      category: form.category,
      visibility: form.visibility,
      all_day: form.all_day,
      start_date: form.start_date,
      end_date: form.end_date || null,
      start_time: form.all_day ? null : form.start_time || null,
      end_time: form.all_day ? null : form.end_time || null,
      location: form.location.trim() || null,
      description: form.description.trim() || null,
    });
  };

  const submitDisabled = !form.title.trim() || !form.start_date;

  return (
    <FormDialog
      open={open}
      title={event ? 'Edit event' : 'Add event'}
      submitLabel={event ? 'Save changes' : 'Add event'}
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Title"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          required
          fullWidth
          autoFocus
          error={Boolean(fieldError('title'))}
          helperText={fieldError('title')}
        />

        <TextField
          label="Category"
          select
          value={form.category}
          onChange={(e) => set('category', e.target.value as EventCategory)}
          fullWidth
          error={Boolean(fieldError('category'))}
          helperText={fieldError('category')}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <MenuItem key={c} value={c}>
              {CATEGORY_META[c].label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Who can see this"
          select
          value={form.visibility}
          onChange={(e) => set('visibility', e.target.value as EventVisibility)}
          fullWidth
          error={Boolean(fieldError('visibility'))}
          helperText={fieldError('visibility') ?? VISIBILITY_META[form.visibility].description}
        >
          {VISIBILITY_OPTIONS.map((v) => (
            <MenuItem key={v} value={v}>
              {VISIBILITY_META[v].label}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            label="Start date"
            type="date"
            value={form.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            required
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldError('start_date'))}
            helperText={fieldError('start_date')}
          />
          <TextField
            label="End date (optional)"
            type="date"
            value={form.end_date}
            onChange={(e) => set('end_date', e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldError('end_date'))}
            helperText={fieldError('end_date') ?? 'Leave blank for a single day'}
          />
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={form.all_day}
              onChange={(e) => set('all_day', e.target.checked)}
            />
          }
          label="All day"
        />

        {!form.all_day && (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField
              label="Start time"
              type="time"
              value={form.start_time}
              onChange={(e) => set('start_time', e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
              error={Boolean(fieldError('start_time'))}
              helperText={fieldError('start_time')}
            />
            <TextField
              label="End time (optional)"
              type="time"
              value={form.end_time}
              onChange={(e) => set('end_time', e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
              error={Boolean(fieldError('end_time'))}
              helperText={fieldError('end_time')}
            />
          </Box>
        )}

        <TextField
          label="Location (optional)"
          value={form.location}
          onChange={(e) => set('location', e.target.value)}
          fullWidth
        />

        <TextField
          label="Description (optional)"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          fullWidth
          multiline
          minRows={2}
        />
      </Stack>
    </FormDialog>
  );
}

export default EventFormDialog;
