import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog, DateField } from '@shared/components';
import type { AssessmentType } from '@shared/types/enums';
import { TYPE_LABEL } from '../statusMeta';
import type { AssessmentCategory, AssessmentListItem } from '../hooks/useAssessments';

export interface AssessmentFormValues {
  title: string;
  type: AssessmentType;
  category_id: string | null;
  assessment_date: string | null;
  max_score: number;
  weight: number;
}

export interface AssessmentFormDialogProps {
  open: boolean;
  /** When provided, the dialog is in edit mode. */
  assessment?: AssessmentListItem | null;
  categories: AssessmentCategory[];
  categoriesLoading?: boolean;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: AssessmentFormValues) => void;
  onClose: () => void;
}

/** The client's list, in the client's order (14 Oct 2026). `exam` is legacy — not offered. */
const TYPE_OPTIONS: readonly AssessmentType[] = [
  'quiz',
  'class_work',
  'project',
  'test',
  'research',
  'journal',
  'assignment',
  'simulation',
  'case_study',
  'group_work',
  'final_project',
  'final_exam',
  'timely_class_attendance',
  'chapel_attendance',
];

const NONE_CATEGORY = '__none__';

/**
 * Create / edit an assessment DEFINITION (assessment-first, API-9). Grade entry is a
 * separate module — this only captures title, type, optional category, date (required),
 * max score and weight. Local controlled state; the parent owns the mutation and passes
 * submitting/error plus any server field errors (422) surfaced inline.
 *
 * Status is NOT edited here — lifecycle transitions go through the dedicated status
 * action on the list (POST /assessments/{id}/status, api-spec §5.6 / API-16).
 *
 * **Weight is read-only** (client request, 14 Oct 2026). It is the assessment's share
 * WITHIN its category (or within the course when no category is weighted): the grade is a
 * weighted mean, so with every assessment at the default 1 they all count equally, and the
 * categories' own weights decide how much each group is worth. New assessments get 1; an
 * existing one keeps whatever it was saved with.
 */
export function AssessmentFormDialog({
  open,
  assessment,
  categories,
  categoriesLoading = false,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: AssessmentFormDialogProps) {
  const editing = Boolean(assessment);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssessmentType>('quiz');
  const [categoryId, setCategoryId] = useState<string>(NONE_CATEGORY);
  const [date, setDate] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [weight, setWeight] = useState('1');

  useEffect(() => {
    if (!open) return;
    setTitle(assessment?.title ?? '');
    setType(assessment?.type ?? 'quiz');
    setCategoryId(assessment?.category_id ?? NONE_CATEGORY);
    setDate(assessment?.assessment_date ?? '');
    setMaxScore(assessment ? String(assessment.max_score) : '100');
    setWeight(assessment ? String(assessment.weight) : '1');
  }, [open, assessment]);

  const maxScoreNum = Number(maxScore);
  const weightNum = Number(weight);
  const maxScoreValid = maxScore.trim() !== '' && Number.isFinite(maxScoreNum) && maxScoreNum > 0;
  const weightValid = weight.trim() !== '' && Number.isFinite(weightNum) && weightNum >= 0;
  const titleValid = title.trim().length > 0;
  const dateValid = date.trim() !== '';
  const canSubmit = titleValid && dateValid && maxScoreValid && weightValid;

  const handleSubmit = () => {
    onSubmit({
      title: title.trim(),
      type,
      category_id: categoryId === NONE_CATEGORY ? null : categoryId,
      assessment_date: date,
      max_score: maxScoreNum,
      weight: weightNum,
    });
  };

  const titleErrors = fieldErrors?.title;
  const maxScoreErrors = fieldErrors?.max_score;
  const weightErrors = fieldErrors?.weight;
  const typeErrors = fieldErrors?.type;

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit assessment' : 'New assessment'}
      submitLabel={editing ? 'Save changes' : 'Create assessment'}
      submitting={submitting}
      submitDisabled={!canSubmit}
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          fullWidth
          autoFocus
          inputProps={{ maxLength: 160, 'aria-required': true }}
          error={Boolean(titleErrors)}
          helperText={titleErrors?.join(' ') ?? 'Required'}
        />

        <TextField
          select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as AssessmentType)}
          fullWidth
          error={Boolean(typeErrors)}
          helperText={typeErrors?.join(' ')}
        >
          {TYPE_OPTIONS.map((opt) => (
            <MenuItem key={opt} value={opt}>
              {TYPE_LABEL[opt]}
            </MenuItem>
          ))}
          {/* An assessment saved with a type no longer offered keeps showing it. */}
          {!TYPE_OPTIONS.includes(type) && (
            <MenuItem value={type}>{TYPE_LABEL[type] ?? type} (as recorded)</MenuItem>
          )}
        </TextField>

        <TextField
          select
          label="Category (optional)"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          fullWidth
          disabled={categoriesLoading}
          helperText={
            categoriesLoading ? 'Loading categories…' : 'Weighting group this assessment belongs to.'
          }
        >
          <MenuItem value={NONE_CATEGORY}>
            <em>No category</em>
          </MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>

        <DateField
          label="Date"
          value={date}
          onChange={setDate}
          required
          fullWidth
          error={Boolean(fieldErrors?.assessment_date)}
          helperText={fieldErrors?.assessment_date?.join(' ') ?? 'Required'}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Max score"
            type="number"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            required
            fullWidth
            inputProps={{ min: 0.01, step: 'any', 'aria-required': true }}
            error={Boolean(maxScoreErrors) || (maxScore.trim() !== '' && !maxScoreValid)}
            helperText={maxScoreErrors?.join(' ') ?? 'Must be greater than 0.'}
          />
          <TextField
            label="Weight"
            type="number"
            value={weight}
            fullWidth
            InputProps={{ readOnly: true }}
            error={Boolean(weightErrors)}
            helperText={
              weightErrors?.join(' ') ??
              'Read-only. Its share within its category — at 1, all assessments count equally.'
            }
          />
        </Stack>
      </Stack>
    </FormDialog>
  );
}

export default AssessmentFormDialog;
