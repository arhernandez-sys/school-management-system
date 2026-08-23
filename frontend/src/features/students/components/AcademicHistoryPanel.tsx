import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  StatCard,
  StatusBadge,
  type StatusKind,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import { useAcademicHistory, useSetStudentProgram } from '../hooks/useAcademics';
import type { AcademicHistoryCourseStatus } from '../types';

/**
 * The student's derived academic history (D30 §D12, brief §27) plus the Dean's programme
 * change.
 *
 * **Nothing here is stored.** Every figure comes back recomputed from enrolments, frozen
 * snapshots, approved credit transfers and the programme curriculum, so a corrected grade
 * shows immediately instead of a cached total drifting.
 *
 * Two things the panel is careful to SHOW rather than hide:
 *
 * * **Which courses no longer count.** After a programme change, work the new award does
 *   not require keeps its grade and is marked as outside the curriculum. §D12 is explicit
 *   that a change must not assume everything carries over, and a screen that quietly
 *   dropped those rows would be claiming it does.
 * * **Credits earned vs the programme's printed total.** The curriculum's own sum is shown
 *   next to the figure printed on the sequence, because the two disagreeing is how a
 *   data-entry slip in an 87-credit plan gets noticed — the same reasoning as the Phase 2B
 *   curriculum builder.
 */
export interface AcademicHistoryPanelProps {
  studentId: string;
}

const STATUS_META: Record<
  AcademicHistoryCourseStatus,
  { label: string; kind: StatusKind; hint: string }
> = {
  completed: {
    label: 'Completed',
    kind: 'success',
    hint: "Passed against this programme's own pass mark",
  },
  failed: {
    label: 'Failed',
    kind: 'error',
    hint: 'Sat and did not reach the pass mark — still owed',
  },
  in_progress: { label: 'In progress', kind: 'info', hint: 'Enrolled, nothing marked yet' },
  transferred: {
    label: 'Transferred',
    kind: 'warning',
    hint: 'Credit carried in from another institution. Counts toward the award, excluded from the GPA.',
  },
  remaining: { label: 'Remaining', kind: 'neutral', hint: 'Required by the programme, not yet taken' },
  // D35 — the client's `coursestatus`. Both answer a different question from the five
  // above: not "how did it go" but "did it count".
  audited: {
    label: 'Audited',
    kind: 'neutral',
    hint: 'Sat without reading it for credit. Earns no credit and is excluded from the GPA entirely.',
  },
  withdrawn: {
    label: 'Withdrawn',
    kind: 'warning',
    hint: 'Sat the course and left. No credit, excluded from the GPA; the transcript prints W/P or W/F.',
  },
};

export function AcademicHistoryPanel({ studentId }: AcademicHistoryPanelProps) {
  const { user } = useAuth();
  const isDean = user?.role === 'principal';

  const query = useAcademicHistory(studentId);
  const programsQuery = useProgramsList({ page: 1, page_size: 100 });
  const changeMut = useSetStudentProgram();

  const [changeOpen, setChangeOpen] = useState(false);
  const [programId, setProgramId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const history = query.data;

  const ordered = useMemo(() => history?.courses ?? [], [history]);

  if (query.isLoading) return <LoadingState variant="table" rows={6} label="Deriving history" />;
  if (query.isError || !history) return <ErrorState onRetry={() => void query.refetch()} />;

  const submitChange = () => {
    setError(null);
    changeMut.mutate(
      {
        studentId,
        body: {
          program_id: programId,
          effective_from: effectiveFrom || null,
          reason: reason.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setChangeOpen(false);
          setProgramId('');
          setEffectiveFrom('');
          setReason('');
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const creditsMismatch =
    history.program_total_credits != null &&
    history.curriculum_required_credits > 0 &&
    history.program_total_credits !== history.curriculum_required_credits;

  return (
    <Stack spacing={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ── Programme ─────────────────────────────────────────────────────────── */}
      <Card variant="outlined">
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Programme
              </Typography>
              <Typography variant="h4" component="p">
                {history.program
                  ? `${history.program.code} — ${history.program.name}`
                  : 'Not registered on a programme'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[history.year_of_study, history.enrollment_load].filter(Boolean).join(' · ') ||
                  '—'}
              </Typography>
            </Box>
            {isDean ? (
              <Button
                variant="outlined"
                startIcon={<SwapHorizIcon />}
                onClick={() => setChangeOpen(true)}
              >
                {history.program ? 'Change programme' : 'Assign programme'}
              </Button>
            ) : (
              <Tooltip title="Only the Dean may move a student between programmes — it re-derives their degree plan (§D14).">
                <Typography variant="caption" color="text.secondary">
                  Dean-only
                </Typography>
              </Tooltip>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* ── The numbers ───────────────────────────────────────────────────────── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        <StatCard
          label="Cumulative GPA"
          value={history.gpa != null ? history.gpa.toFixed(2) : '—'}
          color="primary"
          progress={history.gpa != null ? (history.gpa / 4) * 100 : undefined}
          helperText={`Over ${history.gpa_total_credits} enrolled credits`}
        />
        <StatCard
          label="Credits earned"
          value={history.credits_earned}
          color="success"
          helperText="Passed plus transferred"
        />
        <StatCard
          label="Credits remaining"
          value={history.credits_remaining}
          color="warning"
          helperText="Required by the programme"
        />
        <StatCard
          label="Programme total"
          value={history.program_total_credits ?? '—'}
          color={creditsMismatch ? 'error' : 'info'}
          helperText={
            creditsMismatch
              ? `Curriculum sums to ${history.curriculum_required_credits} — check the sequence`
              : 'As printed on the sequence'
          }
        />
      </Box>

      {creditsMismatch && (
        <Alert severity="warning">
          The programme&apos;s printed total ({history.program_total_credits}) and its
          curriculum&apos;s own required credits ({history.curriculum_required_credits}) do not
          agree. One of the two is wrong — usually a missing or mistyped course in the sequence.
        </Alert>
      )}

      {/* ── Courses ───────────────────────────────────────────────────────────── */}
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h4" component="h3">
              Courses
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            {(Object.keys(STATUS_META) as AcademicHistoryCourseStatus[]).map((status) =>
              history.counts[status] > 0 ? (
                <Tooltip key={status} title={STATUS_META[status].hint}>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${history.counts[status]} ${STATUS_META[status].label.toLowerCase()}`}
                  />
                </Tooltip>
              ) : null,
            )}
          </Stack>

          {ordered.length === 0 ? (
            <EmptyState
              variant="card"
              title="Nothing to derive yet"
              description="This student has no enrolments, results or transferred credit, and their programme has no curriculum entered."
            />
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Academic history by course">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Course</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Plan position</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Credits
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 600 }}>
                      Grade
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ordered.map((row) => (
                    <TableRow key={row.course_id}>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {row.code}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.name}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {row.in_curriculum ? (
                          <Stack spacing={0.25}>
                            <Typography variant="body2">{row.term_label ?? '—'}</Typography>
                            {!row.is_required && (
                              <Typography variant="caption" color="text.secondary">
                                Elective
                              </Typography>
                            )}
                          </Stack>
                        ) : (
                          // The honest reading after a programme change: the grade stands,
                          // but the course is not part of THIS award.
                          <Tooltip title="Taken, but not part of the current programme — it does not count toward this award. The grade is unaffected.">
                            <Typography variant="caption" color="text.secondary">
                              Outside the curriculum
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="right">{row.credits ?? '—'}</TableCell>
                      <TableCell align="center">
                        {row.letter ? (
                          <Stack spacing={0.25} sx={{ alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {row.letter}
                            </Typography>
                            {row.grade_point != null && (
                              <Typography variant="caption" color="text.secondary">
                                {row.grade_point.toFixed(2)}
                              </Typography>
                            )}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip title={STATUS_META[row.status].hint}>
                          <span>
                            <StatusBadge
                              label={STATUS_META[row.status].label}
                              kind={STATUS_META[row.status].kind}
                            />
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Programme history ─────────────────────────────────────────────────── */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h4" component="h3" sx={{ mb: 1.5 }}>
            Programme history
          </Typography>
          {history.program_history.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No programme has been recorded for this student yet.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {history.program_history.map((entry) => (
                <Box
                  key={entry.id}
                  sx={{ display: 'flex', gap: 2, alignItems: 'baseline', flexWrap: 'wrap' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 72 }}>
                    {entry.program.code}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {entry.started_at} → {entry.ended_at ?? 'present'}
                  </Typography>
                  {entry.is_current && <StatusBadge label="Current" kind="success" />}
                  {entry.reason && (
                    <Typography variant="caption" color="text.secondary">
                      {entry.reason}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* ── The Dean's change dialog ──────────────────────────────────────────── */}
      <FormDialog
        open={changeOpen}
        title={history.program ? 'Change programme' : 'Assign a programme'}
        submitLabel={history.program ? 'Change programme' : 'Assign'}
        submitting={changeMut.isPending}
        submitDisabled={programId === '' || programId === history.program?.id}
        onClose={() => setChangeOpen(false)}
        onSubmit={submitChange}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info">
            The current registration is closed and a new one opened, so nothing is lost. The
            history below keeps every programme this student has read, and their grades are
            untouched — but work the new programme does not require stops counting toward the
            award.
          </Alert>
          <TextField
            select
            label="Programme"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            required
            fullWidth
          >
            <MenuItem value="">—</MenuItem>
            {(programsQuery.data?.items ?? [])
              .filter((program) => program.id !== history.program?.id)
              .map((program) => (
                <MenuItem key={program.id} value={program.id}>
                  {program.code} — {program.name}
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label="Effective from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
            helperText="Defaults to today. The outgoing programme is closed the day before this date."
          />
          <TextField
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="Recorded on the history row."
          />
          <Divider />
          <Typography variant="caption" color="text.secondary">
            Pass marks differ by programme — Primary Education passes at C, the others at C+ —
            so a result already earned can change from a pass to a fail, or the other way, when
            the programme changes. The figures above re-derive immediately.
          </Typography>
        </Stack>
      </FormDialog>
    </Stack>
  );
}

export default AcademicHistoryPanel;
