import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import type { CourseListItem } from '@shared/api/generated/model';

export interface CourseFormValues {
  name: string;
  code: string;
  credits: number;
  component: 'GEC' | 'SEC' | 'CEC' | null;
}

export interface CourseFormDialogProps {
  open: boolean;
  /** When provided, the dialog is in edit mode. */
  course?: CourseListItem | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: CourseFormValues) => void;
  onClose: () => void;
}

/**
 * Create / edit a COURSE in the catalog (api-spec §5b; D30 §D2). Local controlled
 * state; the parent owns the mutation and passes submitting/error so a 409
 * duplicate_course_name / duplicate_course_code surfaces at the top of the dialog
 * and, if the server returns field errors, inline on the matching field.
 *
 * D30 added three things a tertiary catalog needs and a high-school subject list did
 * not: the code became REQUIRED (`courses.code` is NOT NULL, and a BAJC course is
 * identified by its code on every programme sequence and on the report card),
 * `credits` — the field that finally lets a stored grade reach a credit value, and
 * without which GPA is impossible (plan §B3) — and the GEC/SEC/CEC component.
 *
 * Dean-only: the Registrar reaches this screen read-only, so the dialog never opens
 * for them (CoursesPage gates on `canWrite(role, 'courses')`).
 */
const COMPONENTS: { value: 'GEC' | 'SEC' | 'CEC'; label: string }[] = [
  { value: 'GEC', label: 'GEC — General Education Core' },
  { value: 'SEC', label: 'SEC — Supporting Education Core' },
  { value: 'CEC', label: 'CEC — Concentration Education Core' },
];

export function CourseFormDialog({
  open,
  course,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: CourseFormDialogProps) {
  const editing = Boolean(course);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('3');
  const [component, setComponent] = useState<'' | 'GEC' | 'SEC' | 'CEC'>('');

  // Reset local state whenever the dialog (re)opens for a given course.
  useEffect(() => {
    if (open) {
      setName(course?.name ?? '');
      setCode(course?.code ?? '');
      setCredits(String(course?.credits ?? 3));
      setComponent(course?.component ?? '');
    }
  }, [open, course]);

  const nameErrors = fieldErrors?.name;
  const codeErrors = fieldErrors?.code;
  const creditsErrors = fieldErrors?.credits;

  const creditsNumber = Number(credits);
  const creditsValid = Number.isInteger(creditsNumber) && creditsNumber > 0;

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit course' : 'Add course'}
      submitLabel={editing ? 'Save changes' : 'Create course'}
      submitting={submitting}
      submitDisabled={name.trim().length === 0 || code.trim().length === 0 || !creditsValid}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          name: name.trim(),
          code: code.trim(),
          credits: creditsNumber,
          component: component || null,
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Course name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          fullWidth
          autoFocus
          inputProps={{ maxLength: 200, 'aria-required': true }}
          error={Boolean(nameErrors)}
          helperText={nameErrors?.join(' ') ?? 'Required'}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Course code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            fullWidth
            inputProps={{ maxLength: 70, 'aria-required': true }}
            error={Boolean(codeErrors)}
            helperText={codeErrors?.join(' ') ?? 'e.g. ITEC1104 or BIOL1204L.'}
          />
          <TextField
            label="Credits"
            type="number"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            required
            fullWidth
            inputProps={{ min: 1, max: 99, 'aria-required': true }}
            error={Boolean(creditsErrors) || (credits !== '' && !creditsValid)}
            helperText={creditsErrors?.join(' ') ?? 'BAJC uses 1, 2, 3, 4, 6 and 9.'}
          />
        </Stack>
        <TextField
          select
          label="Component"
          value={component}
          onChange={(e) => setComponent(e.target.value as '' | 'GEC' | 'SEC' | 'CEC')}
          fullWidth
          helperText="Optional — set it when the programme sequence specifies one."
        >
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {COMPONENTS.map((c) => (
            <MenuItem key={c.value} value={c.value}>
              {c.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </FormDialog>
  );
}

export default CourseFormDialog;
