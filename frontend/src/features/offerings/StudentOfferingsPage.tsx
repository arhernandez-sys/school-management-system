import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useSelectedYear } from '@app/providers/YearContext';
import { useOfferingsList } from './hooks/useOfferings';
import { roomsOf, summarizeMeetings } from './meetingFormat';
import { strings } from '@i18n/strings';
import type { OfferingListItem } from './types';

/**
 * Student "My Courses" (FR-CLS-07).
 *
 * Every offering the student is enrolled in — course, term, lecturer, room and times, one
 * row each. `GET /offerings` is server-scoped to the caller's enrolments for a student, so
 * this renders the response directly with no client-side filtering. The timetable view is
 * the better answer to "where do I need to be"; this table is the roster of what they take,
 * and links there.
 *
 * **D31 — the request gained a semester.** The old comment here read "Classes are YEAR-keyed
 * (`classes.academic_year_id`), so only the year is sent — a semester would narrow nothing."
 * That was true of a homeroom and is false of an offering: an offering belongs to a
 * semester, so a year alone now returns BOTH terms at once, which for a student means the
 * courses they finished listed beside the ones they are sitting. Sending the selected
 * semester is what keeps "My Courses" meaning *this* term.
 */
export function StudentOfferingsPage() {
  const { selectedYearId, selectedSemesterId, selectedPeriod } = useSelectedYear();
  const query = useOfferingsList({
    sort: 'label',
    academic_year_id: selectedYearId,
    semester_id: selectedSemesterId,
    page_size: 100,
  });
  const offerings = query.data?.items ?? [];

  if (query.isLoading) {
    return <LoadingState variant="page" label="Loading your courses" />;
  }
  if (query.isError) {
    return <ErrorState onRetry={() => void query.refetch()} />;
  }
  if (offerings.length === 0) {
    return (
      <EmptyState
        variant="page"
        title="You're not enrolled in any courses yet"
        description="Once the office enrols you, the courses you are taking will appear here."
      />
    );
  }

  const scheduledCount = offerings.filter((o) => o.meetings.length > 0).length;

  const columns: DataTableColumn<OfferingListItem>[] = [
    {
      field: 'course',
      headerName: strings.terms.course,
      primary: true,
      render: (o) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {o.course?.name ?? o.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {/* The section matters to a student: it is how they tell their section of
                Algebra apart from the other one. `label` carries code + section already. */}
            {o.label}
            {o.course?.credits != null ? ` · ${o.course.credits} cr` : ''}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'teachers',
      headerName: strings.terms.lecturer,
      render: (o) =>
        o.teachers.length > 0 ? (
          // Product decision (2026-07): students have no access to lecturer profiles, so
          // lecturer names render as plain text (no link).
          <Typography variant="body2">{o.teachers.map((t) => t.full_name).join(', ')}</Typography>
        ) : (
          <StatusBadge label="Not assigned" kind="neutral" />
        ),
    },
    {
      field: 'meetings',
      headerName: 'When',
      render: (o) => {
        const when = summarizeMeetings(o.meetings);
        return when ? (
          <Typography variant="body2">{when}</Typography>
        ) : (
          <StatusBadge label="Not scheduled" kind="neutral" />
        );
      },
    },
    {
      field: 'room',
      headerName: 'Where',
      render: (o) => {
        const rooms = roomsOf(o.meetings);
        return (
          <Typography variant="body2" color={rooms.length ? undefined : 'text.secondary'}>
            {rooms.length ? rooms.join(' · ') : '—'}
          </Typography>
        );
      },
    },
  ];

  const rowActions = (o: OfferingListItem) => (
    <Button
      component={RouterLink}
      to={`${ROUTES.assessments}?offering_id=${o.id}`}
      size="small"
      startIcon={<AssignmentOutlinedIcon fontSize="small" />}
      aria-label={`See assessments for ${o.label}`}
    >
      Assessments
    </Button>
  );

  const isPast = Boolean(selectedPeriod && !selectedPeriod.isActiveYear);

  return (
    <Box>
      <PageHeader
        title={strings.nav.myCourses}
        subtitle={
          isPast
            ? `The courses you took in ${selectedPeriod?.semesterName}, ${selectedPeriod?.yearName}.`
            : 'Every course you are taking this term. Each has its own lecturer, room and times.'
        }
        primaryAction={
          <Button
            component={RouterLink}
            to={ROUTES.timetable}
            variant="outlined"
            startIcon={<CalendarMonthIcon />}
          >
            My timetable
          </Button>
        }
      />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
        }}
      >
        <StatCard
          label={isPast ? 'Courses taken' : 'Courses I take'}
          value={offerings.length}
          icon={<MenuBookIcon />}
          color="primary"
        />
        <StatCard
          label="On my timetable"
          value={`${scheduledCount}/${offerings.length}`}
          icon={<ScheduleIcon />}
          color={scheduledCount === offerings.length ? 'success' : 'warning'}
          helperText={
            scheduledCount === offerings.length
              ? 'All courses have times'
              : 'Some courses have no times yet'
          }
        />
      </Box>

      <DataTable<OfferingListItem>
        caption="The courses I take"
        columns={columns}
        rows={offerings}
        getRowId={(o) => o.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={0}
        pageSize={100}
        total={offerings.length}
        rowsPerPageOptions={[100]}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle="No courses yet"
        emptyDescription="The courses you take will appear here once you're enrolled."
        rowActions={rowActions}
      />
    </Box>
  );
}

export default StudentOfferingsPage;
