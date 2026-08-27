import { useEffect, useState } from 'react';
import { Alert, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import type { SemesterDetail, TermType } from '@shared/api/generated/model';

export interface TermFormValues {
  name: string;
  term_type: TermType;
  sequence: number;
  start_date: string;
  end_date: string;
  /**
   * The END-TERM cutoff (D32-1). UTC ISO instant, or null to leave the window open /
   * reopen a closed one (brief §18 / D30 §D6). ALWAYS sent, never omitted: the PATCH
   * distinguishes absent from null precisely so an unrelated edit cannot reopen a term,
   * and this dialog genuinely does intend whatever the field shows.
   */
  grade_submission_deadline: string | null;
  /**
   * The mid-session grading window (D32). Same always-sent contract as the deadline. Both
   * null clears the window; the server rejects one without the other with a 422, which
   * `midtermHalfSet` below catches first so the Dean never sees it.
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

/**
 * A stored UTC instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, in the
 * browser's own timezone. Built from the date parts rather than `toISOString().slice()`,
 * which would render the UTC wall clock and show a Belize Dean 23:00 as "05:00 tomorrow".
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** The inverse: a local `datetime-local` value → a UTC ISO instant, or null when blank. */
function fromLocalInput(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
 * **The grade-submission deadline lives here (D30 §D6).** It is entered in the browser's
 * LOCAL time and travels as a UTC instant, because a cutoff is a moment rather than a
 * wall-clock reading — "5pm on the 15th" means 5pm in Belize, and the server stores UTC.
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
  const [deadline, setDeadline] = useState('');
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
    setDeadline(toLocalInput(term?.grade_submission_deadline ?? null));
    setMidStart(toLocalInput(term?.midterm_submission_start ?? null));
    setMidEnd(toLocalInput(term?.midterm_submission_end ?? null));
  }, [open, term, usedSequences]);

  const seqNumber = Number(sequence);
  const seqValid = Number.isInteger(seqNumber) && seqNumber >= 1 && seqNumber <= 99;
  const seqTaken =
    seqValid && seqNumber !== term?.sequence && usedSequences.includes(seqNumber);
  const datesValid = Boolean(start && end && end > start);
  // Mirrors the server's `_assert_midterm_window`: both or neither, end after start.
  // Checked here so the Dean is stopped at the field rather than by a 422 on submit.
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
          grade_submission_deadline: fromLocalInput(deadline),
          midterm_submission_start: fromLocalInput(midStart),
          midterm_submission_end: fromLocalInput(midEnd),
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
          <TextField
            label="Start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldErrors?.start_date)}
          />
          <TextField
            label="End"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldErrors?.end_date) || Boolean(start && end && end <= start)}
            helperText={
              start && end && end <= start ? 'Must be after the start date.' : undefined
            }
          />
        </Stack>
        <TextField
          label="End-session grade submission deadline"
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          fullWidth
          InputLabelProps={{ shrink: true }}
          error={Boolean(fieldErrors?.grade_submission_deadline)}
          helperText={
            fieldErrors?.grade_submission_deadline?.join(' ') ??
            (deadline
              ? 'After this, lecturers can no longer enter grades for this session.'
              : 'Leave blank to keep grade entry open indefinitely.')
          }
        />

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
          <TextField
            label="Freeze starts"
            type="datetime-local"
            value={midStart}
            onChange={(e) => setMidStart(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldErrors?.midterm_submission_start) || midtermHalfSet}
            helperText={fieldErrors?.midterm_submission_start?.join(' ')}
          />
          <TextField
            label="Freeze ends"
            type="datetime-local"
            value={midEnd}
            onChange={(e) => setMidEnd(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
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
