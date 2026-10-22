import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Grid, Paper, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  DataTable,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useAttendanceSummary } from '../hooks/useAttendance';
import { ATTENDANCE_STATUS_META } from '../attendanceStatus';
import { ATTENDANCE_ALERT_THRESHOLD, type PerStudentAttendance } from '../types';

/**
 * One class's attendance on its own (D44) — the drill-down from the alerts list.
 *
 * WHY THIS IS NOT JUST THE SUMMARY TAB. The Summary screen carries an offering picker and
 * a year filter, and arriving there from an alert means the picker has to be driven to the
 * class you were already looking at. This page takes the offering from the URL, so the
 * alert links to the class rather than to a screen where you then find the class.
 *
 * Same data, same `GET /attendance/summary`, same numbers.
 */
export function AttendanceOfferingDetailScreen() {
  const { offeringId } = useParams();
  const summaryQuery = useAttendanceSummary(offeringId ?? null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  if (summaryQuery.isLoading) return <LoadingState variant="page" label="Loading attendance" />;
  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <ErrorState
        title="Could not load this class's attendance"
        onRetry={() => void summaryQuery.refetch()}
      />
    );
  }

  const summary = summaryQuery.data;
  const overall = summary.overall;
  const sessions = overall.present + overall.absent + overall.late + overall.excused;
  const belowFloor = sessions > 0 && overall.pct_present < ATTENDANCE_ALERT_THRESHOLD;
  const byStudent = summary.by_student;

  const columns: DataTableColumn<PerStudentAttendance>[] = [
    {
      field: 'student',
      headerName: 'Student',
      primary: true,
      render: (r) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {r.student.full_name}
        </Typography>
      ),
    },
    { field: 'present', headerName: 'Present', align: 'right', render: (r) => r.present },
    { field: 'absent', headerName: 'Absent', align: 'right', render: (r) => r.absent },
    { field: 'late', headerName: 'Late', align: 'right', render: (r) => r.late },
    { field: 'excused', headerName: 'Excused', align: 'right', render: (r) => r.excused },
    {
      field: 'pct_present',
      headerName: '% present',
      align: 'right',
      render: (r) =>
        r.pct_present < ATTENDANCE_ALERT_THRESHOLD ? (
          <StatusBadge label={`${r.pct_present}%`} kind="error" />
        ) : (
          `${r.pct_present}%`
        ),
    },
  ];

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Button
        startIcon={<ArrowBackIcon />}
        component={RouterLink}
        to={`${ROUTES.attendance}/alerts`}
        sx={{ mb: 1, alignSelf: 'flex-start' }}
      >
        Back to alerts
      </Button>

      <PageHeader
        title={summary.offering.offering.label}
        subtitle={
          summary.offering.teachers.map((t) => t.name).join(', ') || 'No lecturer assigned'
        }
      />

      {belowFloor && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Below {ATTENDANCE_ALERT_THRESHOLD}%</AlertTitle>
          {overall.pct_present}% across {sessions} recorded session{sessions === 1 ? '' : 's'}.
          {sessions < 5 &&
            ' That is a small number of sessions, so the percentage may move a lot yet.'}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={3}>
          <StatCard
            label="% present"
            value={sessions === 0 ? '—' : `${overall.pct_present}%`}
            color={belowFloor ? 'error' : 'success'}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            label="Sessions recorded"
            value={sessions}
            helperText="The denominator behind the percentage"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="Students" value={byStudent.length} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            label="Below the floor"
            value={
              byStudent.filter(
                (r) =>
                  r.present + r.absent + r.late + r.excused > 0 &&
                  r.pct_present < ATTENDANCE_ALERT_THRESHOLD,
              ).length
            }
            color="error"
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Students in this class
        </Typography>
        <DataTable<PerStudentAttendance>
          caption="Per-student attendance for this class"
          columns={columns}
          rows={byStudent.slice(page * pageSize, page * pageSize + pageSize)}
          getRowId={(r) => r.student.id}
          page={page}
          pageSize={pageSize}
          total={byStudent.length}
          onPageChange={setPage}
          // Fixed page size; the handler is required by DataTable.
          onPageSizeChange={() => setPage(0)}
          emptyTitle="No students enrolled"
          emptyDescription="There are no students actively enrolled in this class."
          rowActions={(r) => (
            <Button
              size="small"
              component={RouterLink}
              to={`${ROUTES.attendance}/student/${r.student.id}?offering_id=${offeringId ?? ''}`}
              aria-label={`See ${r.student.full_name}'s attendance on its own`}
            >
              View
            </Button>
          )}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {ATTENDANCE_STATUS_META.map((m) => m.label).join(' · ')}. Late counts as present in
          the percentage, and the percentage divides by sessions RECORDED rather than by
          sessions scheduled.
        </Typography>
      </Paper>
    </Box>
  );
}

export default AttendanceOfferingDetailScreen;
