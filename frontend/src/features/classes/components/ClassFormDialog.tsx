import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import { useAcademicYears } from '@features/settings/hooks/useSettings';
import type { ClassCreateBody } from '../types';

export interface ClassFormDialogProps {
  open: boolean;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: ClassCreateBody) => void;
  onClose: () => void;
}

/**
 * Create a class/section (api-spec §5). Name, grade level, section, and capacity are
 * required; the class is created within an academic year (defaults to the active year).
 * Server-side conflicts (e.g. a duplicate section) are surfaced by the parent.
 */
export function ClassFormDialog({
  open,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: ClassFormDialogProps) {
  const yearsQuery = useAcademicYears();
  const years = yearsQuery.data?.items ?? [];
  const activeYearId = years.find((y) => y.status === 'active')?.id ?? '';

  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [section, setSection] = useState('');
  const [capacity, setCapacity] = useState('30');
  const [academicYearId, setAcademicYearId] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setGradeLevel('');
      setSection('');
      setCapacity('30');
      setAcademicYearId(activeYearId);
    }
  }, [open, activeYearId]);

  const submitDisabled =
    name.trim().length === 0 ||
    gradeLevel.trim().length === 0 ||
    section.trim().length === 0 ||
    capacity.trim().length === 0 ||
    academicYearId.length === 0;

  return (
    <FormDialog
      open={open}
      title="Add class"
      submitLabel="Create class"
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          name: name.trim(),
          grade_level: gradeLevel.trim(),
          section: section.trim(),
          capacity: Number(capacity),
          academic_year_id: academicYearId,
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          fullWidth
          autoFocus
          error={Boolean(fieldErrors?.name)}
          helperText={fieldErrors?.name?.join(' ')}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Grade level"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            required
            fullWidth
            placeholder="Form 1"
            error={Boolean(fieldErrors?.grade_level)}
            helperText={fieldErrors?.grade_level?.join(' ')}
          />
          <TextField
            label="Section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            required
            fullWidth
            placeholder="A"
            error={Boolean(fieldErrors?.section)}
            helperText={fieldErrors?.section?.join(' ')}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Capacity"
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
            fullWidth
            inputProps={{ min: 0 }}
            error={Boolean(fieldErrors?.capacity)}
            helperText={fieldErrors?.capacity?.join(' ')}
          />
          <TextField
            select
            label="Academic year"
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            required
            fullWidth
            disabled={yearsQuery.isLoading}
            error={Boolean(fieldErrors?.academic_year_id)}
            helperText={fieldErrors?.academic_year_id?.join(' ')}
          >
            {years.map((y) => (
              <MenuItem key={y.id} value={y.id}>
                {y.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Stack>
    </FormDialog>
  );
}

export default ClassFormDialog;
