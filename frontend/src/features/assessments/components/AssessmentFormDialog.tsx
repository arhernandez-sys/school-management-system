import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import type { AssessmentType } from '@shared/types/enums';
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

const TYPE_OPTIONS: ReadonlyArray<{ value: AssessmentType; label: string }> = [
  { value: 'quiz', label: 'Quiz' },
  { value: 'test', label: 'Test' },
  { value: 'exam', label: 'Exam' },
  { value: 'assignment', label: 'Assignment' },
];

const NONE_CATEGORY = '__none__';

/**
 * Create / edit an assessment DEFINITION (assessment-first, API-9). Grade entry is a
 * separate module — this only captures title, type, optional category, date, max score
 * and weight. Local controlled state; the parent owns the mutation and passes
 * submitting/error plus any server field errors (422) surfaced inline.
 *
 * Status is NOT edited here — lifecycle transitions go through the dedicated status
 * action on the list (POST /assessments/{id}/status, api-spec §5.6 / API-16).
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
  const canSubmit = titleValid && maxScoreValid && weightValid;

  const handleSubmit = () => {
    onSubmit({
      title: title.trim(),
      type,
      category_id: categoryId === NONE_CATEGORY ? null : categoryId,
      assessment_date: date.trim() === '' ? null : date,
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
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
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

        <TextField
          label="Date (optional)"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          fullWidth
          InputLabelProps={{ shrink: true }}
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
            onChange={(e) => setWeight(e.target.value)}
            fullWidth
            inputProps={{ min: 0, step: 'any' }}
            error={Boolean(weightErrors) || (weight.trim() !== '' && !weightValid)}
            helperText={weightErrors?.join(' ') ?? 'Relative weight in the session grade.'}
          />
        </Stack>
      </Stack>
    </FormDialog>
  );
}

export default AssessmentFormDialog;
