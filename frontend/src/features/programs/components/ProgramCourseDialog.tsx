import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, FormControlLabel, Stack, Switch, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import { useCoursesList } from '@features/settings/hooks/useCourses';
import type { ProgramCourseItem, TermBlock } from '../types';

export interface ProgramCourseFormValues {
  course_id: string;
  term_label: string;
  term_order: number;
  is_required: boolean;
}

export interface ProgramCourseDialogProps {
  open: boolean;
  /** Move/edit mode when provided (add otherwise). */
  entry?: ProgramCourseItem | null;
  /** The block `entry` currently sits in — its label/order seed the form. */
  entryBlock?: TermBlock | null;
  /** Existing blocks, offered as suggestions so labels stay consistent. */
  blocks: TermBlock[];
  /** Course ids already in the plan — excluded from the picker (uq_program_courses). */
  usedCourseIds: string[];
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: ProgramCourseFormValues) => void;
  onClose: () => void;
}

/**
 * Place a course in a programme's plan, or move one between blocks (D30 §D3).
 *
 * ⚠️ THE BLOCK IS A CURRICULUM POSITION, NOT A CALENDAR TERM. "Semester 1" here means
 * "the first semester of this programme's plan" — it is not any dated term in the
 * academic structure. That is why the label is free text with a separate ORDER
 * number: BAJC's blocks are not uniform (Primary Education runs Summer 1 · Sem 1 ·
 * Sem 2 · Spring 1 · Sem 3 · Sem 4 · Spring 2 · Semester 5), and "Spring 1" sorts
 * before "Summer 1" alphabetically, so the label can never be the ordering key.
 *
 * On MOVE the course itself is fixed: swapping one course for another in place is a
 * remove plus an add, and doing it silently would hide the change from anyone reading
 * the curriculum. The API rejects it too.
 */
export function ProgramCourseDialog({
  open,
  entry,
  entryBlock,
  blocks,
  usedCourseIds,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: ProgramCourseDialogProps) {
  const moving = Boolean(entry);

  // The catalog picker. Only needed when ADDING — a move keeps its course.
  const catalog = useCoursesList({ page: 1, page_size: 100, sort: 'code', is_active: true });
  const options = useMemo(
    () => (catalog.data?.items ?? []).filter((c) => !usedCourseIds.includes(c.id)),
    [catalog.data, usedCourseIds],
  );

  const [courseId, setCourseId] = useState('');
  const [termLabel, setTermLabel] = useState('');
  const [termOrder, setTermOrder] = useState('1');
  const [isRequired, setIsRequired] = useState(true);

  useEffect(() => {
    if (!open) return;
    setCourseId(entry?.course.id ?? '');
    setTermLabel(entryBlock?.term_label ?? '');
    // Adding with no block picked yet defaults AFTER the last one, which is what a
    // Dean entering a sequence top-to-bottom wants.
    const nextOrder = blocks.length ? Math.max(...blocks.map((b) => b.term_order)) + 1 : 1;
    setTermOrder(String(entryBlock?.term_order ?? nextOrder));
    setIsRequired(entry?.is_required ?? true);
  }, [open, entry, entryBlock, blocks]);

  const orderNumber = Number(termOrder);
  const orderValid = Number.isInteger(orderNumber) && orderNumber > 0;
  const selected = options.find((c) => c.id === courseId) ?? null;

  // Typing a label that already exists must reuse its order, or the same block would
  // split in two. Surfaced rather than silently corrected.
  const labelClash = blocks.find(
    (b) => b.term_label.toLowerCase() === termLabel.trim().toLowerCase() &&
      b.term_order !== orderNumber,
  );

  return (
    <FormDialog
      open={open}
      title={moving ? 'Move course' : 'Add course to programme'}
      submitLabel={moving ? 'Save changes' : 'Add course'}
      submitting={submitting}
      submitDisabled={(!moving && !courseId) || termLabel.trim().length === 0 || !orderValid}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          course_id: courseId,
          term_label: termLabel.trim(),
          term_order: orderNumber,
          is_required: isRequired,
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        {moving ? (
          <TextField
            label="Course"
            value={`${entry!.course.code} — ${entry!.course.name}`}
            fullWidth
            disabled
            helperText="To swap the course, remove this one and add the other."
          />
        ) : (
          <Autocomplete
            options={options}
            value={selected}
            onChange={(_e, next) => setCourseId(next?.id ?? '')}
            getOptionLabel={(c) => `${c.code} — ${c.name} (${c.credits} cr)`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={catalog.isLoading}
            noOptionsText="Every active course is already in this programme."
            renderInput={(params) => (
              <TextField
                {...params}
                label="Course"
                required
                error={Boolean(fieldErrors?.course_id)}
                helperText={
                  fieldErrors?.course_id?.join(' ') ??
                  'Courses already in this programme are hidden — a course appears once per plan.'
                }
              />
            )}
          />
        )}

        <Autocomplete
          freeSolo
          options={blocks.map((b) => b.term_label)}
          value={termLabel}
          onInputChange={(_e, next) => {
            setTermLabel(next);
            const match = blocks.find(
              (b) => b.term_label.toLowerCase() === next.trim().toLowerCase(),
            );
            if (match) setTermOrder(String(match.term_order));
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Session block"
              required
              error={Boolean(fieldErrors?.term_label)}
              helperText={
                fieldErrors?.term_label?.join(' ') ??
                'A position in the plan, not a calendar session — e.g. "Summer 1", "Semester 3", "Spring 2".'
              }
            />
          )}
        />

        <TextField
          label="Block order"
          type="number"
          value={termOrder}
          onChange={(e) => setTermOrder(e.target.value)}
          required
          fullWidth
          inputProps={{ min: 1, max: 99 }}
          error={Boolean(fieldErrors?.term_order) || (termOrder !== '' && !orderValid)}
          helperText={
            fieldErrors?.term_order?.join(' ') ??
            'Where this block sits in the sequence. "Spring 1" sorts before "Summer 1" alphabetically, so the order is explicit.'
          }
        />

        {labelClash && (
          <Alert severity="warning">
            “{labelClash.term_label}” already sits at order {labelClash.term_order}. Using a
            different order here will split it into two blocks with the same name.
          </Alert>
        )}

        <FormControlLabel
          control={
            <Switch checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
          }
          label="Required for the award"
        />
      </Stack>
    </FormDialog>
  );
}

export default ProgramCourseDialog;
