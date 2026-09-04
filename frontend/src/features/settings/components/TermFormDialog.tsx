import { useEffect, useState } from 'react';
import { Alert, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DateField, DateTimeField, FormDialog } from '@shared/components';
import type { SemesterDetail, TermType } from '@shared/api/generated/model';

export interface TermFormValues {
  name: string;
  term_type: TermType;
  sequence: number;
  start_date: string;
  end_date: string;
  /**
   * The mid-session freeze window (D32/D33). ALWAYS sent, never omitted: `PATCH
   * /settings/semesters` distinguishes an absent key from an explicit null precisely so an
   * unrelated edit cannot clear a window, and this dialog genuinely does intend whatever
   * the two fields show. Both null clears it; the server rejects one without the other
   * with a 422, which `midtermHalfSet` below catches first so the Dean never sees it.
   */
  midterm_submission_start: string | null;
  midterm_submission_end: string | null;
}

export interface TermFormDialogProps {
  open: boolean;
  /** Edit mode when provided (add otherwise). */
  term?: SemesterDetail | null;
  /** Name of the year the term belongs to — shown for orientation. */
  yearName: string;
  /** Sequences already used in this year, so the clash is caught before the 409. */
  usedSequences: number[];
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: TermFormValues) => void;
  onClose: () => void;
}

const TERM_TYPES: { value: TermType; label: string }[] = [
  { value: 'semester', label: 'Semester' },
  { value: 'summer', label: 'Summer block' },
  { value: 'spring', label: 'Spring block' },
];

/*
 * D42 §6 — `toLocalInput` / `fromLocalInput` lived here and converted between a stored UTC
 * instant and the `YYYY-MM-DDTHH:mm` a native `datetime-local` input wants. `DateTimeField`
 * owns that conversion now (and owns it identically for every other datetime in the app,
 * which is the point), so this dialog holds the UTC instants it actually sends.
 */

/**
 * Add or correct one CALENDAR term (D30 §D3). Dean-only.
 *
 * This dialog is new because the endpoints behind it are: before D30 the school's
 * whole calendar came from creating an academic year, which hard-created exactly two
 * semesters, and `semesters.sequence` was CHECK-constrained to (1,2). BAJC runs
 * Summer and Spring blocks alongside its numbered semesters, so a third term was
 * simply not representable.
 *
 * There is deliberately no delete: a term anchors every enrolment, assessment,
 * attendance record and frozen snapshot inside it, and those FKs are RESTRICT.
 * Correcting a term is the supported operation.
 *
 * **D42 §5 — the END-SESSION grade submission deadline is gone from this form.** The
 * client asked for the mid-session freeze to be the only thing that stops grade entry, so
 * the field went and `grades/service` stopped enforcing the column. `TermFormValues` no
 * longer carries it, which means a PATCH from this dialog OMITS it — and omission is
 * "leave alone" on `SemesterUpdateRequest`, so renaming a session cannot wipe the value a
 * historic term still holds.
 *
 * The mid-session window that remains is entered in the browser's LOCAL time and travels
 * as a UTC instant, because a freeze boundary is a moment rather than a wall-clock reading
 * — "5pm on the 15th" means 5pm in Belize, and the server stores UTC.
 */
export function TermFormDialog({
  open,
  term,
  yearName,
  usedSequences,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: TermFormDialogProps) {
  const editing = Boolean(term);
  const [name, setName] = useState('');
  const [termType, setTermType] = useState<TermType>('semester');
  const [sequence, setSequence] = useState('1');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [midStart, setMidStart] = useState('');
  const [midEnd, setMidEnd] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(term?.name ?? '');
    setTermType(term?.term_type ?? 'semester');
    const next = usedSequences.length ? Math.max(...usedSequences) + 1 : 1;
    setSequence(String(term?.sequence ?? next));
    setStart(term?.start_date ?? '');
    setEnd(term?.end_date ?? '');
    setMidStart(term?.midterm_submission_start ?? '');
    setMidEnd(term?.midterm_submission_end ?? '');
  }, [open, term, usedSequences]);

  const seqNumber = Number(sequence);
  const seqValid = Number.isInteger(seqNumber) && seqNumber >= 1 && seqNumber <= 99;
  const seqTaken =
    seqValid && seqNumber !== term?.sequence && usedSequences.includes(seqNumber);
  const datesValid = Boolean(start && end && end > start);
  // Mirrors the server's `_assert_midterm_window`: both or neither, end after start.
  // Checked here so the Dean is stopped at the field rather than by a 422 on submit.
  //
  // The `<=` string comparison is still valid on the UTC ISO instants these now hold:
  // `toISOString()` always emits the same fixed-width Z-normalised shape, so lexical order
  // is chronological order. It would NOT be valid on mixed-offset ISO strings.
  const midtermHalfSet = Boolean(midStart) !== Boolean(midEnd);
  const midtermOutOfOrder = Boolean(midStart && midEnd && midEnd <= midStart);
  const midtermValid = !midtermHalfSet && !midtermOutOfOrder;

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit session' : `Add a session to ${yearName}`}
      submitLabel={editing ? 'Save changes' : 'Add session'}
      submitting={submitting}
      submitDisabled={
        name.trim().length === 0 || !seqValid || seqTaken || !datesValid || !midtermValid
      }
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          name: name.trim(),
          term_type: termType,
          sequence: seqNumber,
          start_date: start,
          end_date: end,
          midterm_submission_start: midStart || null,
          midterm_submission_end: midEnd || null,
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        {!editing && (
          <Alert severity="info">
            The session is added inactive. Activating it moves the school&apos;s current
            session, so that stays a separate, deliberate action.
          </Alert>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Session name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            autoFocus
            placeholder="e.g. Summer 1"
            error={Boolean(fieldErrors?.name)}
            helperText={fieldErrors?.name?.join(' ')}
          />
          <TextField
            select
            label="Session type"
            value={termType}
            onChange={(e) => setTermType(e.target.value as TermType)}
            fullWidth
          >
            {TERM_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <TextField
          label="Order in the year"
          type="number"
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
          required
          fullWidth
          inputProps={{ min: 1, max: 99 }}
          error={Boolean(fieldErrors?.sequence) || seqTaken}
          helperText={
            seqTaken
              ? 'Another session in this year already uses that number.'
              : (fieldErrors?.sequence?.join(' ') ?? 'Unique within the academic year.')
          }
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <DateField
            label="Start"
            value={start}
            onChange={setStart}
            required
            fullWidth
            error={Boolean(fieldErrors?.start_date)}
          />
          <DateField
            label="End"
            value={end}
            onChange={setEnd}
            required
            fullWidth
            error={Boolean(fieldErrors?.end_date) || Boolean(start && end && end <= start)}
            helperText={
              start && end && end <= start ? 'Must be after the start date.' : undefined
            }
          />
        </Stack>
        <Divider />
        <Typography variant="subtitle2">Mid-session freeze</Typography>
        <Typography variant="body2" color="text.secondary">
          {/* D33 ask 7 — this copy used to read "the period lecturers submit mid-session marks
              in", which was true of the D32 behaviour and is now the opposite of it. The
              Dean sets these two dates and needs to know what they DO. */}
          <strong>Grade entry is frozen between these two dates</strong>, so the mid-session
          figures cannot move while the mid-session report is being produced. Marks go in{' '}
          <em>before</em> the freeze starts. After it ends, entry reopens: a new mark is
          entered as normal, and changing one that was already recorded needs a revision
          you approve.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <DateTimeField
            label="Freeze starts"
            value={midStart}
            onChange={setMidStart}
            fullWidth
            error={Boolean(fieldErrors?.midterm_submission_start) || midtermHalfSet}
            helperText={fieldErrors?.midterm_submission_start?.join(' ')}
          />
          <DateTimeField
            label="Freeze ends"
            value={midEnd}
            onChange={setMidEnd}
            fullWidth
            error={
              Boolean(fieldErrors?.midterm_submission_end) ||
              midtermHalfSet ||
              midtermOutOfOrder
            }
            helperText={
              midtermOutOfOrder
                ? 'Must be after the freeze start date.'
                : fieldErrors?.midterm_submission_end?.join(' ')
            }
          />
        </Stack>
        {midtermHalfSet && (
          <Alert severity="warning">
            Set both mid-session dates, or clear both. A half-configured window cannot be
            used to decide which assessments belong to the mid-session period.
          </Alert>
        )}
        {!midStart && !midEnd && (
          <Alert severity="info" variant="outlined">
            Leave both blank if this session has no mid-session period. Nothing is frozen, and
            mid-session reports and grade revisions stay unavailable for it.
          </Alert>
        )}
        <Alert severity="info" variant="outlined">
          A session may fall outside its academic year&apos;s dates — BAJC&apos;s Summer
          block legitimately does, and the report card prints it that way.
        </Alert>
      </Stack>
    </FormDialog>
  );
}

export default TermFormDialog;
