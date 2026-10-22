import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog, DateField } from '@shared/components';
import type { AssessmentCategory, AssessmentListItem } from '../hooks/useAssessments';

export interface AssessmentFormValues {
  title: string;
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

const NONE_CATEGORY = '__none__';

/** Every assessment counts equally within its category (client request, 17 Oct 2026). */
const FIXED_WEIGHT = 1;

/**
 * Create / edit an assessment DEFINITION (assessment-first, API-9). Grade entry is a
 * separate module — this only captures title, optional category, date (required) and max
 * score.
 *
 * **There is no Type field** (client request, 16 Oct 2026): the category is the only way
 * to group an assessment. The server stores an omitted type as `assignment`, and nothing
 * displays it. Local controlled state; the parent owns the mutation and passes
 * submitting/error plus any server field errors (422) surfaced inline.
 *
 * Status is NOT edited here — lifecycle transitions go through the dedicated status
 * action on the list (POST /assessments/{id}/status, api-spec §5.6 / API-16).
 *
 * **Weight is hidden and always 1** (client request, 17 Oct 2026 — it was editable from
 * 16 Oct). It is the assessment's share WITHIN its category, so at 1 for every assessment
 * they all count equally and the categories' own weights decide how much each group is
 * worth. Saving an edit also resets an older non-1 weight to 1.
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
  const [categoryId, setCategoryId] = useState<string>(NONE_CATEGORY);
  const [date, setDate] = useState('');
  const [maxScore, setMaxScore] = useState('100');

  useEffect(() => {
    if (!open) return;
    setTitle(assessment?.title ?? '');
    setCategoryId(assessment?.category_id ?? NONE_CATEGORY);
    setDate(assessment?.assessment_date ?? '');
    setMaxScore(assessment ? String(assessment.max_score) : '100');
  }, [open, assessment]);

  const maxScoreNum = Number(maxScore);
  const maxScoreValid = maxScore.trim() !== '' && Number.isFinite(maxScoreNum) && maxScoreNum > 0;
  const titleValid = title.trim().length > 0;
  const dateValid = date.trim() !== '';
  const canSubmit = titleValid && dateValid && maxScoreValid;

  const handleSubmit = () => {
    onSubmit({
      title: title.trim(),
      category_id: categoryId === NONE_CATEGORY ? null : categoryId,
      assessment_date: date,
      max_score: maxScoreNum,
      weight: FIXED_WEIGHT,
    });
  };

  const titleErrors = fieldErrors?.title;
  const maxScoreErrors = fieldErrors?.max_score;

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
      </Stack>
    </FormDialog>
  );
}

export default AssessmentFormDialog;
