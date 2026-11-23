import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Paper, Stack, Typography } from '@mui/material';
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { useYearFilter } from '@shared/hooks';
import { ROUTES } from '@shared/constants/routes';
import { useAttendanceAlerts } from '../hooks/useAttendance';
import type { AttendanceAlertOffering, AttendanceAlertStudent } from '../types';

/**
 * Attendance alerts (D44) — every class and every student below the floor, for one
 * academic year.
 *
 * WHY THIS IS ITS OWN SCREEN. The Summary tab answers "how is THIS class doing", and it
 * needs an offering picked before it can answer anything. The question the client actually
 * asked — "who is in trouble?" — is the one nobody can ask there, because it spans classes
 * and the screen is scoped to one.
 *
 * ⚠️ THE DENOMINATOR IS SHOWN NEXT TO EVERY PERCENTAGE, and that is not decoration. The
 * server counts records WRITTEN, not sessions scheduled: a class whose register has been
 * marked twice, with one absence, reads 50% and is not in trouble. An alert list that hides
 * that is one people learn to close without reading, which costs more than not having it.
 *
 * SCOPING IS THE SERVER'S. `GET /attendance/alerts` is built on the same call that scopes
 * the offering picker, so a lecturer sees their own classes and no one else's without this
 * screen saying anything about roles.
 */
export function AttendanceAlertsScreen() {
  const { years, yearId, setYearId, activeYearId, isLoading: yearsLoading } =
    useYearFilter();
  const alertsQuery = useAttendanceAlerts(yearId);
  const [offeringPage, setOfferingPage] = useState(0);
  const [studentPage, setStudentPage] = useState(0);
  const pageSize = 10;

  const data = alertsQuery.data;
  const threshold = data?.threshold ?? 80;

  const sessionsCell = (r: { sessions_recorded: number }) => (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
      <Typography variant="body2">{r.sessions_recorded}</Typography>
      {/* A handful of marked days is not a trend. Saying so on the row is cheaper than
          explaining it to whoever acts on the list. */}
      {r.sessions_recorded < 5 && (
        <Typography variant="caption" color="text.secondary">
          (few)
        </Typography>
      )}
    </Stack>
  );

  const offeringColumns: DataTableColumn<AttendanceAlertOffering>[] = [
    {
      field: 'offering',
      headerName: 'Class',
      primary: true,
      render: (r) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {r.offering.offering.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {r.offering.teachers.map((t) => t.name).join(', ') || 'No lecturer assigned'}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'pct_present',
      headerName: '% present',
      align: 'right',
      render: (r) => <StatusBadge label={`${r.pct_present}%`} kind="error" />,
    },
    {
      field: 'sessions_recorded',
      headerName: 'Sessions',
      align: 'right',
      render: sessionsCell,
    },
    {
      field: 'enrolled_count',
      headerName: 'Enrolled',
      align: 'right',
      hideOnMobile: true,
      render: (r) => r.enrolled_count,
    },
  ];

  const studentColumns: DataTableColumn<AttendanceAlertStudent>[] = [
    {
      field: 'student',
      headerName: 'Student',
      primary: true,
      render: (r) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {r.student.full_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {r.student.student_number} · {r.offering.offering.label}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'pct_present',
      headerName: '% present',
      align: 'right',
      render: (r) => <StatusBadge label={`${r.pct_present}%`} kind="error" />,
    },
    {
      field: 'sessions_recorded',
      headerName: 'Sessions',
      align: 'right',
      render: sessionsCell,
    },
    {
      field: 'absent',
      headerName: 'Absent',
      align: 'right',
      hideOnMobile: true,
      render: (r) => r.absent,
    },
  ];

  if (alertsQuery.isLoading) return <LoadingState variant="page" label="Loading alerts" />;
  if (alertsQuery.isError) {
    return (
      <ErrorState
        title="Could not load attendance alerts"
        onRetry={() => void alertsQuery.refetch()}
      />
    );
  }

  const offerings = data?.offerings ?? [];
  const students = data?.students ?? [];
  const allClear = offerings.length === 0 && students.length === 0;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Attendance alerts"
        subtitle={`Classes and students below ${threshold}% for the selected year`}
      />

      <Box sx={{ mb: 2, maxWidth: 280 }}>
        <YearSelect
          years={years}
          value={yearId}
          onChange={setYearId}
          activeYearId={activeYearId}
          isLoading={yearsLoading}
          fullWidth
        />
      </Box>

      {/* The year has no active record at all — distinct from "nothing is below the
          floor", and saying so avoids reporting a clean bill of health for a year nobody
          has marked a register in. */}
      {data?.academic_year_id === null ? (
        <EmptyState
          title="No academic year selected"
          description="Pick a year to see which classes and students are falling behind."
        />
      ) : allClear ? (
        <Alert severity="success">
          <AlertTitle>Nothing below {threshold}%</AlertTitle>
          Every class and student with attendance recorded this year is at or above the floor.
        </Alert>
      ) : (
        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Classes below {threshold}%
            </Typography>
            <DataTable<AttendanceAlertOffering>
              caption={`Course offerings whose overall attendance is below ${threshold} per cent`}
              columns={offeringColumns}
              rows={offerings.slice(offeringPage * pageSize, offeringPage * pageSize + pageSize)}
              getRowId={(r) => r.offering.offering.id}
              page={offeringPage}
              pageSize={pageSize}
              total={offerings.length}
              onPageChange={setOfferingPage}
              // Fixed page size: an alert list is meant to be short. The handler is
              // required by DataTable, so it resets to the first page rather than
              // pretending the size can change.
              onPageSizeChange={() => setOfferingPage(0)}
              emptyTitle="No classes below the floor"
              emptyDescription="Every class with attendance recorded is at or above it."
              rowActions={(r) => (
                <Button
                  size="small"
                  component={RouterLink}
                  to={`${ROUTES.attendance}/offering/${r.offering.offering.id}`}
                  aria-label={`See attendance for ${r.offering.offering.label} on its own`}
                >
                  View class
                </Button>
              )}
            />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Students below {threshold}%
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Listed per class, not averaged across a student&apos;s courses — being diligent
              in three and absent from a fourth is exactly the case worth seeing.
            </Typography>
            <DataTable<AttendanceAlertStudent>
              caption={`Students whose attendance in a class is below ${threshold} per cent`}
              columns={studentColumns}
              rows={students.slice(studentPage * pageSize, studentPage * pageSize + pageSize)}
              getRowId={(r) => `${r.student.id}-${r.offering.offering.id}`}
              page={studentPage}
              pageSize={pageSize}
              total={students.length}
              onPageChange={setStudentPage}
              onPageSizeChange={() => setStudentPage(0)}
              emptyTitle="No students below the floor"
              emptyDescription="Every student with attendance recorded is at or above it."
              rowActions={(r) => (
                <Button
                  size="small"
                  component={RouterLink}
                  to={`${ROUTES.attendance}/student/${r.student.id}?offering_id=${r.offering.offering.id}`}
                  aria-label={`See ${r.student.full_name}'s attendance on its own`}
                >
                  View student
                </Button>
              )}
            />
          </Paper>
        </Stack>
      )}
    </Box>
  );
}

export default AttendanceAlertsScreen;
