import { useMemo, useState } from 'react';
import {
  Box,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
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
import { formatSchoolDateWithWeekday } from '@shared/utils/schoolDate';
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
  // D39 (Meeting #2 item 1) — dd/mm/yyyy. The weekday stays: a student reading their own
  // attendance is checking which day they missed.
  return formatSchoolDateWithWeekday(iso, 'long');
}

const ALL = 'all';

/**
 * My Attendance (design-system §7 Module 8, student view) — the signed-in student's own
 * read-only attendance. Server-scoped to the caller (the student id is never taken from
 * the URL).
 *
 * Attendance is recorded PER OFFERING: each lecturer marks the register for their own
 * course, so a student can be present in one course and absent from another on the same
 * day. The screen therefore leads with a course picker. "All courses" shows the overall
 * rate plus a per-course breakdown and labels every history row with its course; picking
 * one course narrows the cards and the history to that course's marks only.
 */
export function MyAttendanceScreen() {
  const { selectedYearId, selectedSemesterId, selectedPeriod } = useSelectedYear();
  const query = useMyAttendance(selectedYearId, selectedSemesterId);
  const [picked, setPicked] = useState<string>(ALL);

  const offerings = useMemo(() => query.data?.offerings ?? [], [query.data]);
  const byId = useMemo(
    () => new Map(offerings.map((o) => [o.offering.offering.id, o])),
    [offerings],
  );

  if (query.isLoading) return <LoadingState variant="page" label="Loading your attendance" />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  // A period switch can leave a course selected that the new period does not have; fall
  // back to "All courses" rather than showing an empty course.
  const selected = picked === ALL ? null : (byId.get(picked) ?? null);
  const selectedId = selected ? picked : ALL;
  const summary = selected ? selected.summary : query.data.summary;
  const history = selected
    ? query.data.history.filter((h) => h.offering_id === selectedId)
    : query.data.history;
  const courseName = (offeringId: string) => {
    const ref = byId.get(offeringId)?.offering.offering;
    return ref ? `${ref.label} — ${ref.course.name}` : '—';
  };

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

      {offerings.length > 0 && (
        <Box sx={{ mb: 2, maxWidth: 480 }}>
          <TextField
            select
            fullWidth
            size="small"
            label="Course"
            value={selectedId}
            onChange={(e) => setPicked(e.target.value)}
            helperText={
              selected && selected.offering.teachers.length > 0
                ? `Lecturer: ${selected.offering.teachers.map((t) => t.name).join(', ')}`
                : ' '
            }
          >
            <MenuItem value={ALL}>All courses</MenuItem>
            {offerings.map((o) => (
              <MenuItem key={o.offering.offering.id} value={o.offering.offering.id}>
                {o.offering.offering.label} — {o.offering.offering.course.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

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

      {!selected && offerings.length > 0 && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            By course
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, flexShrink: 0 }}>
            <Table size="small" aria-label="Attendance by course">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Course</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Lecturer</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">
                    Present rate
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">
                    Absent
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">
                    Late
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">
                    Excused
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {offerings.map((o) => {
                  const ref = o.offering.offering;
                  const s = o.summary;
                  const marked = s.present + s.absent + s.late + s.excused;
                  return (
                    <TableRow
                      key={ref.id}
                      hover
                      onClick={() => setPicked(ref.id)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        {ref.label} — {ref.course.name}
                      </TableCell>
                      <TableCell>
                        {o.offering.teachers.map((t) => t.name).join(', ') || '—'}
                      </TableCell>
                      <TableCell align="right">
                        {marked === 0 ? 'Not recorded' : `${s.pct_present}%`}
                      </TableCell>
                      <TableCell align="right">{s.absent}</TableCell>
                      <TableCell align="right">{s.late}</TableCell>
                      <TableCell align="right">{s.excused}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {history.length === 0 ? (
        <EmptyState
          title="No attendance recorded yet"
          description={
            selected
              ? 'Attendance for this course will appear here once your lecturer records it.'
              : 'Your attendance will appear here once your lecturers record it.'
          }
        />
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          <Table aria-label="My attendance history" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                {!selected && <TableCell sx={{ fontWeight: 600 }}>Course</TableCell>}
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((row) => (
                // (date, offering) is unique: one mark per offering per day.
                <TableRow key={`${row.date}:${row.offering_id}`}>
                  <TableCell>{longDate(row.date)}</TableCell>
                  {!selected && <TableCell>{courseName(row.offering_id)}</TableCell>}
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
