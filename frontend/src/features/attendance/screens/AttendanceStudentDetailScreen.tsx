import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Grid, Paper, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useAttendanceSummary } from '../hooks/useAttendance';
import { ATTENDANCE_STATUS_META } from '../attendanceStatus';
import { ATTENDANCE_ALERT_THRESHOLD } from '../types';

/**
 * One student's attendance in one class (D44) — the drill-down from the summary table and
 * from the alerts list.
 *
 * BUILT ON `GET /attendance/summary`, not on a new endpoint. That call already returns the
 * per-student tallies for the offering, so this screen picks one row out of a response the
 * app fetches anyway — and the number it shows is therefore, by construction, the same one
 * the summary table showed. A dedicated per-student endpoint would have been a second
 * derivation of a figure that already exists in one place.
 *
 * ⚠️ WHAT IT DOES NOT SHOW: a day-by-day history. `by_date` on the summary is per CLASS,
 * not per student, so there is no per-student daily series to render without new server
 * work. Stating the absence beats inventing a chart from data that does not say that.
 */
export function AttendanceStudentDetailScreen() {
  const { studentId } = useParams();
  const [searchParams] = useSearchParams();
  const offeringId = searchParams.get('offering_id') ?? undefined;

  const summaryQuery = useAttendanceSummary(offeringId ?? null);

  if (!offeringId) {
    return (
      <EmptyState
        title="No class chosen"
        description="A student's attendance is recorded per class, so this page needs to know which one. Open it from the attendance summary or the alerts list."
      />
    );
  }
  if (summaryQuery.isLoading) return <LoadingState variant="page" label="Loading attendance" />;
  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <ErrorState
        title="Could not load this student's attendance"
        onRetry={() => void summaryQuery.refetch()}
      />
    );
  }

  const summary = summaryQuery.data;
  const row = summary.by_student.find((s) => s.student.id === studentId);

  if (!row) {
    return (
      <EmptyState
        title="Not on this roster"
        description="This student is not actively enrolled in the class you came from."
      />
    );
  }

  const sessions = row.present + row.absent + row.late + row.excused;
  const belowFloor = sessions > 0 && row.pct_present < ATTENDANCE_ALERT_THRESHOLD;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Button
        startIcon={<ArrowBackIcon />}
        component={RouterLink}
        to={`${ROUTES.attendance}/summary?offering_id=${offeringId}`}
        sx={{ mb: 1, alignSelf: 'flex-start' }}
      >
        Back to the class summary
      </Button>

      <PageHeader
        title={row.student.full_name}
        subtitle={`${row.student.student_number} · ${summary.offering.offering.label}`}
        primaryAction={
          <Button
            variant="outlined"
            startIcon={<PersonOutlineIcon />}
            component={RouterLink}
            to={`${ROUTES.students}/${row.student.id}`}
          >
            Student record
          </Button>
        }
      />

      {belowFloor && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Below {ATTENDANCE_ALERT_THRESHOLD}% in this class</AlertTitle>
          {row.pct_present}% across {sessions} recorded session{sessions === 1 ? '' : 's'}.
          {sessions < 5 &&
            ' That is a small number of sessions, so the percentage may move a lot yet.'}
        </Alert>
      )}

      {sessions === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No attendance has been recorded for this student in this class yet. That is not the
          same as a 0% rate.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={3}>
          <StatCard
            label="% present"
            value={sessions === 0 ? '—' : `${row.pct_present}%`}
            color={belowFloor ? 'error' : 'success'}
            helperText={`Class average ${summary.overall.pct_present}%`}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            label="Sessions recorded"
            value={sessions}
            helperText="The denominator behind the percentage"
          />
        </Grid>
        {ATTENDANCE_STATUS_META.filter((m) => m.value === 'absent' || m.value === 'late').map(
          (m) => (
            <Grid key={m.value} item xs={6} md={3}>
              <StatCard label={m.label} value={row[m.value]} />
            </Grid>
          ),
        )}
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          Breakdown
        </Typography>
        <Stack spacing={1}>
          {ATTENDANCE_STATUS_META.map((m) => (
            <Stack
              key={m.value}
              direction="row"
              sx={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Typography variant="body2">{m.label}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {row[m.value]}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Late counts as present in the percentage, as it does everywhere else in the system.
          The percentage divides by sessions RECORDED, not by sessions scheduled.
        </Typography>
      </Paper>

      <Box sx={{ mt: 2 }}>
        <StatusBadge
          label={`Class overall ${summary.overall.pct_present}%`}
          kind={
            summary.overall.pct_present < ATTENDANCE_ALERT_THRESHOLD ? 'warning' : 'neutral'
          }
        />
      </Box>
    </Box>
  );
}

export default AttendanceStudentDetailScreen;
