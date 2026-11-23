import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import GavelIcon from '@mui/icons-material/Gavel';
import { EmptyState, ErrorState, LoadingState } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import {
  useExcuseEnrollment,
  useExcuseStudentSessions,
  useProgressionPreview,
  type ProgressionIssue,
  type ProgressionStudent,
} from '../hooks/useSettings';

/**
 * Year-end progression review — the Dean's screen (`students.progression`).
 *
 * Lists every student the year-end check touches and what archiving will do to them.
 * For anyone who would repeat, the Dean can grant an exception with a reason:
 *
 *  - **Excuse missing sessions** — student level, this year only (entered from another
 *    school, missed Summer for a documented reason).
 *  - **Excuse a course** — a failed / withdrawn / ungraded course stops blocking the
 *    student. The grade, GPA and transcript are NOT changed; this only decides whether
 *    the student may move up a year.
 *
 * Excused issues stay visible (struck through, with the reason) so a decision can be
 * seen and undone. The server is authoritative: every action is principal-only and
 * audited.
 */
type Filter = 'attention' | 'moving' | 'all';

type Pending =
  | { kind: 'student'; student: ProgressionStudent }
  | { kind: 'course'; student: ProgressionStudent; issue: ProgressionIssue };

const OUTCOME_LABEL: Record<ProgressionStudent['outcome'], string> = {
  promote: 'Moves to Second year',
  complete: 'Completes',
  repeat: 'Repeats',
  skip: 'Not checked',
};
const OUTCOME_COLOR: Record<
  ProgressionStudent['outcome'],
  'success' | 'primary' | 'warning' | 'default'
> = { promote: 'success', complete: 'primary', repeat: 'warning', skip: 'default' };

export interface ProgressionDialogProps {
  open: boolean;
  yearId: string;
  yearName: string;
  onClose: () => void;
}

export function ProgressionDialog({ open, yearId, yearName, onClose }: ProgressionDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const query = useProgressionPreview(open ? yearId : undefined);
  const excuseStudent = useExcuseStudentSessions(yearId);
  const excuseCourse = useExcuseEnrollment(yearId);

  const [filter, setFilter] = useState<Filter>('attention');
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const data = query.data;
  const students = useMemo(() => {
    const all = data?.students ?? [];
    if (filter === 'all') return all;
    if (filter === 'moving') return all.filter((s) => s.outcome === 'promote' || s.outcome === 'complete');
    // Needs attention: repeating, or moving only because of an exception.
    return all.filter(
      (s) => s.outcome === 'repeat' || s.issues.some((i) => i.excused),
    );
  }, [data, filter]);

  const busy = excuseStudent.isPending || excuseCourse.isPending;

  const submit = (excused: boolean, target: Pending) => {
    setActionError(null);
    const opts = {
      onSuccess: () => {
        setPending(null);
        setReason('');
      },
      onError: (err: unknown) => setActionError(apiErrorMessage(err)),
    };
    const body = { excused, reason: excused ? reason.trim() : null };
    if (target.kind === 'student') {
      excuseStudent.mutate({ studentId: target.student.student_id, body }, opts);
    } else if (target.issue.enrollment_id) {
      excuseCourse.mutate({ enrollmentId: target.issue.enrollment_id, body }, opts);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Year-end progression · {yearName}</DialogTitle>
      <DialogContent dividers>
        {query.isLoading && <LoadingState variant="form" label="Checking each student's results" />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}

        {data && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {data.terms.length > 0
                ? `When the year is archived, students who passed every course in ${data.terms.join(', ')} move up: First → Second, Second → Completed. Everyone else repeats unless you grant an exception.`
                : 'This year has no Summer or Semester sessions, so no student will change year.'}
            </Typography>

            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              <Chip color="success" label={`${data.promoted} to Second year`} />
              <Chip color="primary" label={`${data.completed} completed`} />
              <Chip color="warning" label={`${data.repeating} repeating`} />
              {data.skipped > 0 && <Chip label={`${data.skipped} not checked`} />}
            </Stack>

            <ToggleButtonGroup
              size="small"
              exclusive
              value={filter}
              onChange={(_, v: Filter | null) => v && setFilter(v)}
              aria-label="Filter students"
            >
              <ToggleButton value="attention">Needs attention</ToggleButton>
              <ToggleButton value="moving">Moving up</ToggleButton>
              <ToggleButton value="all">All</ToggleButton>
            </ToggleButtonGroup>

            {actionError && !pending && <Alert severity="error">{actionError}</Alert>}

            {students.length === 0 ? (
              <EmptyState
                variant="card"
                title={filter === 'attention' ? 'Nobody needs attention' : 'No students here'}
                description={
                  filter === 'attention'
                    ? 'Every checked student passed, or already has an exception.'
                    : 'No students match this filter.'
                }
              />
            ) : (
              <Stack spacing={1.25}>
                {students.map((s) => (
                  <StudentRow
                    key={s.student_id}
                    student={s}
                    disabled={busy}
                    onExcuseStudent={() => {
                      setReason('');
                      setActionError(null);
                      setPending({ kind: 'student', student: s });
                    }}
                    onUnexcuseStudent={() => submit(false, { kind: 'student', student: s })}
                    onExcuseCourse={(issue) => {
                      setReason('');
                      setActionError(null);
                      setPending({ kind: 'course', student: s, issue });
                    }}
                    onUnexcuseCourse={(issue) => submit(false, { kind: 'course', student: s, issue })}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>

      {/* Reason prompt */}
      <Dialog open={Boolean(pending)} onClose={busy ? undefined : () => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {pending?.kind === 'student' ? 'Excuse missing sessions' : 'Excuse this course'}
        </DialogTitle>
        <DialogContent>
          {pending && (
            <Typography variant="body2" sx={{ mb: 2 }}>
              {pending.kind === 'student'
                ? `${pending.student.full_name}: sessions they did not take this year will not stop them moving up.`
                : `${pending.student.full_name}: "${pending.issue.message}" will not stop them moving up. The grade and transcript stay as they are.`}
            </Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            required
            label="Reason"
            placeholder="e.g. Entered from another college in Semester 1"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            inputProps={{ maxLength: 255 }}
            helperText="Kept on the student's record and in the audit log."
          />
          {actionError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<GavelIcon />}
            disabled={busy || reason.trim().length < 3}
            onClick={() => pending && submit(true, pending)}
          >
            {busy ? 'Saving…' : 'Grant exception'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

function StudentRow({
  student: s,
  disabled,
  onExcuseStudent,
  onUnexcuseStudent,
  onExcuseCourse,
  onUnexcuseCourse,
}: {
  student: ProgressionStudent;
  disabled: boolean;
  onExcuseStudent: () => void;
  onUnexcuseStudent: () => void;
  onExcuseCourse: (issue: ProgressionIssue) => void;
  onUnexcuseCourse: (issue: ProgressionIssue) => void;
}) {
  const hasMissing = s.issues.some((i) => i.kind === 'missing_term');
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography variant="subtitle2">
            {s.full_name}{' '}
            <Typography component="span" variant="caption" color="text.secondary">
              {s.student_number}
              {s.year_of_study ? ` · ${s.year_of_study} year` : ''}
            </Typography>
          </Typography>
        </Box>
        <Chip size="small" color={OUTCOME_COLOR[s.outcome]} label={OUTCOME_LABEL[s.outcome]} />
      </Stack>

      {s.outcome === 'skip' && s.reasons.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {s.reasons.join(' ')}
        </Typography>
      )}

      {s.issues.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Stack spacing={0.75}>
            {s.issues.map((i, idx) => (
              <Stack
                key={`${i.enrollment_id ?? i.term_name}-${idx}`}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      textDecoration: i.excused ? 'line-through' : 'none',
                      color: i.excused ? 'text.secondary' : 'text.primary',
                    }}
                  >
                    {i.message}
                  </Typography>
                  {i.excused && (
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <CheckCircleOutlineIcon color="success" sx={{ fontSize: 14 }} />
                      <Typography variant="caption" color="success.main">
                        Excused by the Dean{i.excuse_reason ? ` — ${i.excuse_reason}` : ''}
                      </Typography>
                    </Stack>
                  )}
                </Box>
                {/* Course issues are excused one by one; missing sessions at student level. */}
                {i.kind !== 'missing_term' && i.enrollment_id && (
                  <Button
                    size="small"
                    disabled={disabled}
                    color={i.excused ? 'inherit' : 'primary'}
                    onClick={() => (i.excused ? onUnexcuseCourse(i) : onExcuseCourse(i))}
                    sx={{ flexShrink: 0 }}
                  >
                    {i.excused ? 'Remove exception' : 'Excuse course'}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </>
      )}

      {(hasMissing || s.terms_excused) && (
        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            variant={s.terms_excused ? 'text' : 'outlined'}
            color={s.terms_excused ? 'inherit' : 'primary'}
            disabled={disabled}
            onClick={s.terms_excused ? onUnexcuseStudent : onExcuseStudent}
          >
            {s.terms_excused ? 'Remove missing-session exception' : 'Excuse missing sessions'}
          </Button>
        </Box>
      )}
    </Paper>
  );
}

export default ProgressionDialog;
