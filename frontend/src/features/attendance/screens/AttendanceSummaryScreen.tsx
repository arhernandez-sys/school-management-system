import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Grid, Paper, Typography } from '@mui/material';
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatCard,
  ChartWithTable,
  DataTable,
  type DataTableColumn,
} from '@shared/components';
import { useYearFilter } from '@shared/hooks';
import { useAttendanceSections, useAttendanceSummary } from '../hooks/useAttendance';
import { AttendanceToolbar } from '../components/AttendanceToolbar';
import { ATTENDANCE_STATUS_META } from '../attendanceStatus';
import type { PerStudentAttendance } from '../types';

/** Format an ISO date (YYYY-MM-DD) as a short weekday+day label for the trend axis. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

/**
 * Attendance history / summary (design-system §7.6b, §7 Module 8) — per-section rate over
 * the recent (~2-week) window. Reached by teachers (own classes) and P/S (view-all). Shows
 * headline counts (StatCards) + a daily "% present" trend and a status breakdown, each via
 * ChartWithTable so the data is available to screen readers as an equivalent table.
 *
 * The selected section persists to the URL (?section_id=).
 */
export function AttendanceSummaryScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionId = searchParams.get('section_id');
  const { yearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  // Client-side pagination for the per-student list (the payload arrives whole).
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const sectionsQuery = useAttendanceSections(yearId);
  const summaryQuery = useAttendanceSummary(sectionId);

  // Switching year clears the (year-specific) section so the effect re-picks one.
  const handleChangeYear = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('year', value);
        next.delete('section_id');
        return next;
      },
      { replace: true },
    );

  // Preselect the caller's first available class. As in the register screen, this `items[0]`
  // is a picker default, not a "primary class" assumption (D29).
  useEffect(() => {
    if (!sectionId && sectionsQuery.data && sectionsQuery.data.items.length > 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('section_id', sectionsQuery.data!.items[0]!.id);
          return next;
        },
        { replace: true },
      );
    }
  }, [sectionId, sectionsQuery.data, setSearchParams]);

  // Reset the per-student list to page 1 whenever the class changes.
  useEffect(() => setPage(0), [sectionId]);

  const handleChangeSection = (value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section_id', value);
      return next;
    });

  if (sectionsQuery.isLoading) return <LoadingState variant="page" label="Loading classes" />;
  if (sectionsQuery.isError) return <ErrorState onRetry={() => void sectionsQuery.refetch()} />;
  if (sectionsQuery.data && sectionsQuery.data.items.length === 0) {
    return (
      <>
        <PageHeader title="Attendance summary" />
        <EmptyState
          variant="page"
          title="No classes to show"
          description="There are no classes available to summarize."
        />
      </>
    );
  }

  const overall = summaryQuery.data?.overall;
  const trendData =
    summaryQuery.data?.by_date.map((d) => ({ name: shortDate(d.date), value: d.pct_present })) ?? [];
  const breakdownData = overall
    ? ATTENDANCE_STATUS_META.map((m) => ({ name: m.label, value: overall[m.value] }))
    : [];

  const byStudent = summaryQuery.data?.by_student ?? [];
  const pagedStudents = byStudent.slice(page * pageSize, page * pageSize + pageSize);

  const studentColumns: DataTableColumn<PerStudentAttendance>[] = [
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
      render: (r) => `${r.pct_present}%`,
    },
  ];

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Attendance summary"
        subtitle={
          summaryQuery.data
            ? `${summaryQuery.data.section.name} · last two weeks`
            : 'Per-section attendance over the recent window'
        }
      />

      <AttendanceToolbar
        sections={sectionsQuery.data?.items ?? []}
        sectionId={sectionId}
        onSectionChange={handleChangeSection}
        showDate={false}
        years={years}
        yearId={yearId}
        activeYearId={activeYearId}
        onYearChange={handleChangeYear}
        yearsLoading={yearsLoading}
      />

      {summaryQuery.isLoading && <LoadingState variant="cards" rows={3} />}
      {summaryQuery.isError && (
        <ErrorState
          message="We couldn't load the attendance summary for this class."
          onRetry={() => void summaryQuery.refetch()}
        />
      )}

      {summaryQuery.data && overall && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} md={3}>
              <StatCard
                label="Present rate"
                value={`${overall.pct_present}%`}
                color="success"
                helperText="Present or late, over the window"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatCard label="Absent" value={overall.absent} color="error" />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatCard label="Late" value={overall.late} color="warning" />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatCard label="Excused" value={overall.excused} color="info" />
            </Grid>
          </Grid>

          {trendData.length === 0 ? (
            <EmptyState
              title="No attendance recorded yet"
              description="Once attendance is recorded for this class, its trend appears here."
            />
          ) : (
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} md={7}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <ChartWithTable
                    title="Attendance rate over time"
                    data={trendData}
                    type="line"
                    valueLabel="% present"
                    categoryLabel="Date"
                  />
                </Paper>
              </Grid>
              <Grid item xs={12} md={5}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <ChartWithTable
                    title="Attendance breakdown"
                    data={breakdownData}
                    type="bar"
                    valueLabel="Records"
                    categoryLabel="Status"
                  />
                </Paper>
              </Grid>
            </Grid>
          )}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Students in this class
            </Typography>
            <DataTable<PerStudentAttendance>
              caption="Per-student attendance days over the summary window"
              columns={studentColumns}
              rows={pagedStudents}
              getRowId={(r) => r.student.id}
              page={page}
              pageSize={pageSize}
              total={byStudent.length}
              onPageChange={setPage}
              onPageSizeChange={(ps) => {
                setPageSize(ps);
                setPage(0);
              }}
              emptyTitle="No students enrolled"
              emptyDescription="There are no students enrolled in this class."
            />
          </Paper>
        </>
      )}
    </Box>
  );
}

export default AttendanceSummaryScreen;
