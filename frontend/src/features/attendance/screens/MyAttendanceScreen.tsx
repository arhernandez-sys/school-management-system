import {
  Box,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatCard,
  StatusBadge,
} from '@shared/components';
import type { StatusKind } from '@shared/components';
import type { AttendanceStatus } from '@shared/types/enums';
import { useSelectedYear } from '@app/providers/YearContext';
import { useMyAttendance } from '../hooks/useAttendance';
import { attendanceStatusMeta } from '../attendanceStatus';

const STATUS_TO_KIND: Record<AttendanceStatus, StatusKind> = {
  present: 'success',
  absent: 'error',
  late: 'warning',
  excused: 'info',
};

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * My Attendance (design-system §7 Module 8, student view) — the signed-in student's own
 * read-only attendance summary + daily history. Server-scoped to the caller (the student
 * id is never taken from the URL). Headline rate as a StatCard; history as a labelled
 * table where each status shows a StatusBadge (label + color, never color alone).
 */
export function MyAttendanceScreen() {
  const { selectedYearId, selectedSemesterId, selectedPeriod } = useSelectedYear();
  const query = useMyAttendance(selectedYearId, selectedSemesterId);

  if (query.isLoading) return <LoadingState variant="page" label="Loading your attendance" />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const { summary, history } = query.data;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* "this term" was hardcoded — it misdescribed every past period the switcher
          can reach. */}
      <PageHeader
        title="My attendance"
        subtitle={
          selectedPeriod
            ? `Your attendance record for ${selectedPeriod.label}.`
            : 'Your attendance record.'
        }
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <StatCard label="Present rate" value={`${summary.pct_present}%`} color="success" />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="Absent" value={summary.absent} color="error" />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="Late" value={summary.late} color="warning" />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="Excused" value={summary.excused} color="info" />
        </Grid>
      </Grid>

      {history.length === 0 ? (
        <EmptyState
          title="No attendance recorded yet"
          description="Your daily attendance will appear here once your teacher records it."
        />
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          <Table aria-label="My attendance history">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((row) => (
                <TableRow key={row.date}>
                  <TableCell>{longDate(row.date)}</TableCell>
                  <TableCell>
                    <StatusBadge
                      label={attendanceStatusMeta(row.status).label}
                      kind={STATUS_TO_KIND[row.status]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default MyAttendanceScreen;
