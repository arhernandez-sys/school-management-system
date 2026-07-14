import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Grid, Paper } from '@mui/material';
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatCard,
  ChartWithTable,
} from '@shared/components';
import { useAttendanceSections, useAttendanceSummary } from '../hooks/useAttendance';
import { AttendanceToolbar } from '../components/AttendanceToolbar';
import { ATTENDANCE_STATUS_META } from '../attendanceStatus';

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

  const sectionsQuery = useAttendanceSections();
  const summaryQuery = useAttendanceSummary(sectionId);

  // Default to the caller's first available section.
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
            <Grid container spacing={3} sx={{ flex: 1, minHeight: 0 }}>
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
        </>
      )}
    </Box>
  );
}

export default AttendanceSummaryScreen;
