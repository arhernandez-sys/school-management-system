import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
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
import { formatSchoolDate, formatSchoolDateTime } from '@shared/utils/schoolDate';
import { useDecideReopen, useReopenRequests, useWithdrawReopen } from './hooks/useReopenRequests';
import type { ReopenRequest, ReopenRequestStatus } from './types';

/**
 * D47 — the marking-reopen queue. Same shape as the grade revision queue on purpose: the
 * Dean sees every request and approves (choosing how many days) or denies; a lecturer sees
 * their own and can withdraw one still pending. The scoping is the server's.
 */
const STATUS_KIND: Record<ReopenRequestStatus, StatusKind> = {
  pending: 'warning',
  approved: 'success',
  denied: 'error',
};
const STATUS_LABEL: Record<ReopenRequestStatus, string> = {
  pending: 'Awaiting the Dean',
  approved: 'Reopened',
  denied: 'Declined',
};
const FILTERS: { value: ReopenRequestStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'Awaiting a decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Declined' },
  { value: 'all', label: 'All requests' },
];

export function AssessmentReopenScreen() {
  const { user } = useAuth();
  const isDean = user?.role === 'principal';

  const [status, setStatus] = useState<ReopenRequestStatus | 'all'>('pending');
  const [decide, setDecide] = useState<{ row: ReopenRequest; approve: boolean } | null>(null);
  const [days, setDays] = useState('2');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useReopenRequests(status === 'all' ? undefined : status);
  const decideMut = useDecideReopen();
  const withdrawMut = useWithdrawReopen();

  if (query.isLoading) return <LoadingState variant="cards" rows={3} label="Loading requests" />;
  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <ErrorState onRetry={() => void query.refetch()} />
      </PageContainer>
    );
  }
  const rows = query.data.items;
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 14;

  const submitDecision = () => {
    if (!decide) return;
    setError(null);
    decideMut.mutate(
      {
        requestId: decide.row.id,
        body: {
          status: decide.approve ? 'approved' : 'denied',
          ...(decide.approve ? { granted_days: daysNumber } : {}),
          decision_note: note.trim() || null,
        },
      },
      {
        onSuccess: () => setDecide(null),
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Marking reopen requests"
        subtitle={
          isDean
            ? 'Lecturers who missed the 5-day marking window ask you to reopen it. Until you do, their blank marks count as 0.'
            : 'Assessments you have asked the Dean to reopen for marking.'
        }
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField
          select
          size="small"
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value as ReopenRequestStatus | 'all')}
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
              ? 'A lecturer asks from the grading screen once an assessment has locked.'
              : 'Open a locked assessment in the Gradebook and use "Ask the Dean to reopen".'
          }
        />
      ) : (
        <Stack spacing={1.5}>
          {rows.map((row) => (
            <Card key={row.id} variant="outlined">
              {/* Two-column rows (left / right) keep each request to a few dense lines
                  instead of a tall stack of one-fact paragraphs. */}
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack spacing={0.75}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {row.assessment_title}
                    </Typography>
                    <StatusBadge label={STATUS_LABEL[row.status]} kind={STATUS_KIND[row.status]} />
                    <Box sx={{ flexGrow: 1 }} />
                    {row.blank_count > 0 && (
                      <Chip
                        size="small"
                        color={row.status === 'pending' ? 'warning' : 'default'}
                        label={`${row.blank_count} without a mark`}
                      />
                    )}
                  </Stack>
                  <TwoColumnLine
                    left={[
                      row.offering?.label,
                      row.offering?.course.name,
                      row.assessment_date ? `held ${formatSchoolDate(row.assessment_date)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={[
                      row.marking_closes_at ? `Marking closed ${formatSchoolDate(row.marking_closes_at)}` : null,
                      row.status === 'approved' && row.reopened_until
                        ? `open until ${formatSchoolDate(row.reopened_until)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      Reason:{' '}
                    </Box>
                    {row.reason}
                  </Typography>
                  {row.decision_note && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                      <Box
                        component="span"
                        sx={{ color: row.status === 'approved' ? 'success.main' : 'error.main', fontWeight: 600 }}
                      >
                        Dean's note:{' '}
                      </Box>
                      {row.decision_note}
                    </Typography>
                  )}
                  <TwoColumnLine
                    caption
                    left={`Requested by ${row.requested_by_name} on ${formatSchoolDateTime(row.created_at)}`}
                    right={
                      row.decided_at
                        ? `${STATUS_LABEL[row.status]} by ${row.decided_by_name ?? 'the Dean'} on ${formatSchoolDateTime(row.decided_at)}`
                        : null
                    }
                  />
                  {row.status === 'pending' && (isDean || row.can_withdraw) && (
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, pt: 0.5 }}>
                      {isDean && (
                        <>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() => {
                              setDays('2');
                              setNote('');
                              setDecide({ row, approve: true });
                            }}
                          >
                            Reopen
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => {
                              setNote('');
                              setDecide({ row, approve: false });
                            }}
                          >
                            Decline
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
                            withdrawMut.mutate(row.id, { onError: (err) => setError(apiErrorMessage(err)) })
                          }
                        >
                          Withdraw
                        </Button>
                      )}
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <FormDialog
        open={decide !== null}
        title={decide?.approve ? 'Reopen marking' : 'Decline this request'}
        submitLabel={decide?.approve ? 'Reopen' : 'Decline'}
        submitting={decideMut.isPending}
        submitDisabled={Boolean(decide?.approve) && !daysValid}
        onClose={() => setDecide(null)}
        onSubmit={submitDecision}
      >
        {decide && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              <strong>{decide.row.assessment_title}</strong> · {decide.row.offering?.label} ·{' '}
              {decide.row.requested_by_name}
            </Typography>
            {decide.approve ? (
              <>
                <TextField
                  label="Days to reopen for"
                  type="number"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  inputProps={{ min: 1, max: 14, step: 1 }}
                  error={!daysValid}
                  helperText={
                    daysValid
                      ? `Marks can be entered until the end of the day, ${daysNumber} ${daysNumber === 1 ? 'day' : 'days'} from today.`
                      : 'Between 1 and 14 days.'
                  }
                  sx={{ maxWidth: 220 }}
                  autoFocus
                />
                <Alert severity="info">
                  While it is open, blank marks stop counting as 0. Any still blank when it closes
                  again count as 0.
                </Alert>
              </>
            ) : (
              <Alert severity="warning">
                The assessment stays locked and the {decide.row.blank_count} blank{' '}
                {decide.row.blank_count === 1 ? 'mark keeps' : 'marks keep'} counting as 0.
              </Alert>
            )}
            <TextField
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="Visible to the lecturer who asked."
            />
          </Stack>
        )}
      </FormDialog>
    </PageContainer>
  );
}

export default AssessmentReopenScreen;

/** One line, two columns: `left` flush left, `right` flush right; stacks on a phone. */
function TwoColumnLine({
  left,
  right,
  caption = false,
}: {
  left: string;
  right?: string | null;
  caption?: boolean;
}) {
  const variant = caption ? 'caption' : 'body2';
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      sx={{ justifyContent: 'space-between', columnGap: 2, rowGap: 0.25 }}
    >
      <Typography variant={variant} color="text.secondary">
        {left}
      </Typography>
      {right && (
        <Typography variant={variant} color="text.secondary" sx={{ textAlign: { sm: 'right' } }}>
          {right}
        </Typography>
      )}
    </Stack>
  );
}
