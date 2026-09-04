import { useState } from 'react';
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  PageContainer,
  PageHeader,
  StatusBadge,
  type StatusKind,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAuth } from '@features/auth/hooks/useAuth';
import {
  useDecideGradeRevision,
  useGradeRevisions,
  useWithdrawGradeRevision,
} from './hooks/useRevisions';
import {
  REVISION_STATUS_LABEL,
  type GradeRevision,
  type GradeRevisionStatus,
} from './revisionTypes';
import { formatSchoolDateTime } from '@shared/utils/schoolDate';

/**
 * The grade-revision queue (D30 §D7/§D8, brief §20).
 *
 * **One screen, two audiences, and the server decides which is which.** The Dean sees every
 * request and the approve/deny controls; a Lecturer sees only their OWN requests and can
 * withdraw one that is still pending. The scoping is done in the query, not hidden in the
 * UI — a Lecturer asking for the list simply does not get other people's rows.
 *
 * **This is not a notifications table** (§D8). It is a filtered read of
 * `grade_revision_requests`, and `?status=pending` IS the Dean's work list — the same thing
 * the bell badge counts.
 *
 * Every row shows the original mark beside the proposed one, because that pair is the
 * decision: the Dean is ruling on a change, not on a number.
 */
const STATUS_KIND: Record<GradeRevisionStatus, StatusKind> = {
  pending: 'warning',
  approved: 'success',
  denied: 'error',
};

const FILTERS: { value: GradeRevisionStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'Awaiting a decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'all', label: 'All requests' },
];

/*
 * D42 §6 — this file's private date+time formatter is gone. It called
 * `toLocaleString(undefined, …)`, i.e. the BROWSER's locale, so it printed a US month-first
 * stamp on a US-locale machine while every plain date on the same screen was already
 * dd/mm/yyyy. `formatSchoolDateTime` renders `dd/mm/yyyy HH:MM` in America/Belize and is
 * the one place that decision lives.
 */

export function GradeRevisionsScreen() {
  const { user } = useAuth();
  const isDean = user?.role === 'principal';

  const [status, setStatus] = useState<GradeRevisionStatus | 'all'>('pending');
  const [decide, setDecide] = useState<{ row: GradeRevision; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useGradeRevisions(status === 'all' ? {} : { status });
  const decideMut = useDecideGradeRevision();
  const withdrawMut = useWithdrawGradeRevision();

  if (query.isLoading) return <LoadingState variant="cards" rows={3} label="Loading requests" />;
  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <ErrorState onRetry={() => void query.refetch()} />
      </PageContainer>
    );
  }

  const rows = query.data.items;

  const submitDecision = () => {
    if (!decide) return;
    setError(null);
    decideMut.mutate(
      {
        revisionId: decide.row.id,
        body: {
          status: decide.approve ? 'approved' : 'denied',
          decision_note: note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDecide(null);
          setNote('');
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Grade revisions"
        subtitle={
          isDean
            ? 'Requests from Lecturers to change a recorded grade. Your decision is what applies it.'
            : 'Revisions you have asked the Dean to make. The original mark is kept either way.'
        }
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <TextField
          select
          size="small"
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value as GradeRevisionStatus | 'all')}
          sx={{ minWidth: 220 }}
        >
          {FILTERS.map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        {isDean && query.data.pending_for_me > 0 && (
          <Chip color="warning" label={`${query.data.pending_for_me} awaiting your decision`} />
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {rows.length === 0 ? (
        <EmptyState
          variant="card"
          title={status === 'pending' ? 'Nothing awaiting a decision' : 'No requests here'}
          description={
            isDean
              ? 'A Lecturer files a revision from the grading screen; it appears here for your decision.'
              : 'Open an assessment in Grades and use "Request revision" on a student row.'
          }
        />
      ) : (
        <Stack spacing={1.5}>
          {rows.map((row) => (
            <Card key={row.id} variant="outlined">
              <CardContent>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {row.student?.full_name ?? 'Unknown student'}
                    </Typography>
                    <StatusBadge
                      label={REVISION_STATUS_LABEL[row.status]}
                      kind={STATUS_KIND[row.status]}
                    />
                    <Box sx={{ flexGrow: 1 }} />
                    {/* The pair IS the decision — the Dean is ruling on a change. */}
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        {row.original_score ?? '—'}
                      </Typography>
                      <ArrowForwardIcon fontSize="small" color="action" />
                      <Typography variant="body1" sx={{ fontWeight: 700 }}>
                        {row.proposed_score}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        of {row.max_score ?? '—'}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Typography variant="body2" color="text.secondary">
                    {/* D31: one derived offering label replaces the old
                        subject_code · subject_name · section_name triple. */}
                    {[
                      row.offering?.label,
                      row.offering?.course.name,
                      row.offering?.semester?.name,
                      row.assessment_title,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>

                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {row.reason}
                  </Typography>

                  <Typography variant="caption" color="text.secondary">
                    Requested by {row.requested_by_name} on {formatSchoolDateTime(row.created_at)}
                    {row.decided_at &&
                      ` · ${row.status} by ${row.decided_by_name ?? 'the Dean'} on ${formatSchoolDateTime(row.decided_at)}`}
                  </Typography>

                  {row.decision_note && (
                    <Alert severity={row.status === 'approved' ? 'success' : 'info'}>
                      {row.decision_note}
                    </Alert>
                  )}

                  {(row.status === 'pending' && (isDean || row.can_withdraw)) && (
                    <>
                      <Divider />
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        {isDean && (
                          <>
                            <Tooltip title="Applies the revised mark. The original score is kept and the change is recorded in the audit trail.">
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                onClick={() => {
                                  setNote('');
                                  setDecide({ row, approve: true });
                                }}
                              >
                                Approve
                              </Button>
                            </Tooltip>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => {
                                setNote('');
                                setDecide({ row, approve: false });
                              }}
                            >
                              Deny
                            </Button>
                          </>
                        )}
                        <Box sx={{ flexGrow: 1 }} />
                        {row.can_withdraw && (
                          <Button
                            size="small"
                            color="inherit"
                            disabled={withdrawMut.isPending}
                            onClick={() =>
                              withdrawMut.mutate(row.id, {
                                onError: (err) => setError(apiErrorMessage(err)),
                              })
                            }
                          >
                            Withdraw
                          </Button>
                        )}
                      </Stack>
                    </>
                  )}

                  {row.status === 'pending' && !isDean && !row.can_withdraw && (
                    <Typography variant="caption" color="text.secondary">
                      Only the Dean may approve or deny a grade revision.
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <FormDialog
        open={decide !== null}
        title={decide?.approve ? 'Approve this revision' : 'Deny this revision'}
        submitLabel={decide?.approve ? 'Approve' : 'Deny'}
        submitting={decideMut.isPending}
        onClose={() => setDecide(null)}
        onSubmit={submitDecision}
      >
        {decide && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              {decide.row.student?.full_name} · {decide.row.assessment_title} ·{' '}
              <strong>
                {decide.row.original_score ?? '—'} → {decide.row.proposed_score}
              </strong>
            </Typography>
            {decide.approve ? (
              <Alert severity="info">
                The revised mark is applied and the student&apos;s term grade, letter and GPA
                move with it. <strong>The original score is kept</strong> — it stays on the
                grade record and in the audit trail alongside the change. This applies even if
                the term&apos;s grade-submission deadline has passed.
              </Alert>
            ) : (
              <Alert severity="warning">
                The grade is left exactly as it is. The refusal is recorded, and a decision
                cannot be reversed later — a fresh request is the way to change course.
              </Alert>
            )}
            <TextField
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="Visible to the Lecturer who asked. Appended — earlier notes are kept."
            />
          </Stack>
        )}
      </FormDialog>
    </PageContainer>
  );
}

export default GradeRevisionsScreen;
