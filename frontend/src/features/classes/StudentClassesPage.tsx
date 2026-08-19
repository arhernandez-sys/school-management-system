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
import { useClassesList } from './hooks/useClasses';
import { roomsOf, summarizeMeetings } from './meetingFormat';
import { strings } from '@i18n/strings';
import type { ClassListItem } from './types';

/**
 * Student "My Classes" (FR-CLS-07).
 *
 * **D29 rewrite.** This screen used to read `items[0]` — the student's ONE homeroom — and
 * list the subjects taught inside it, on the premise that students "never roam between
 * classrooms". A sixth-former enrols in each subject class individually, so the list is now
 * every class they take: subject, class name, teacher, room and times, one row each.
 *
 * `GET /classes` is server-scoped to the caller's enrolled classes for a student, so this
 * renders the response directly with no client-side filtering. The timetable view is the
 * better answer to "where do I need to be" — this table is the roster of what they take, and
 * links there.
 */
export function StudentClassesPage() {
  const { selectedYearId, selectedPeriod } = useSelectedYear();
  // Classes are YEAR-keyed (`classes.academic_year_id`), so only the year is sent — a
  // semester would narrow nothing here.
  const query = useClassesList({
    sort: 'name',
    academic_year_id: selectedYearId,
    page_size: 100,
  });
  const classes = query.data?.items ?? [];

  if (query.isLoading) {
    return <LoadingState variant="page" label="Loading your classes" />;
  }
  if (query.isError) {
    return <ErrorState onRetry={() => void query.refetch()} />;
  }
  if (classes.length === 0) {
    return (
      <EmptyState
        variant="page"
        title="You're not enrolled in any classes yet"
        description="Once the office enrols you in your subject classes, they'll appear here."
      />
    );
  }

  const scheduledCount = classes.filter((c) => c.meetings.length > 0).length;

  const columns: DataTableColumn<ClassListItem>[] = [
    {
      field: 'subject',
      headerName: strings.terms.course,
      primary: true,
      render: (c) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {c.subject?.name ?? c.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {/* The class name matters to a student now: it is how they tell their Math
                class apart from the other one. */}
            {c.name}
            {c.subject?.code ? ` · ${c.subject.code}` : ''}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'teachers',
      headerName: strings.terms.lecturer,
      render: (c) =>
        c.teachers.length > 0 ? (
          // Product decision (2026-07): students have no access to teacher profiles, so
          // teacher names render as plain text (no link).
          <Typography variant="body2">{c.teachers.map((t) => t.full_name).join(', ')}</Typography>
        ) : (
          <StatusBadge label="Not assigned" kind="neutral" />
        ),
    },
    {
      field: 'meetings',
      headerName: 'When',
      render: (c) => {
        const when = summarizeMeetings(c.meetings);
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
      render: (c) => {
        const rooms = roomsOf(c.meetings);
        return (
          <Typography variant="body2" color={rooms.length ? undefined : 'text.secondary'}>
            {rooms.length ? rooms.join(' · ') : '—'}
          </Typography>
        );
      },
    },
  ];

  const rowActions = (c: ClassListItem) =>
    c.class_subject_id ? (
      <Button
        component={RouterLink}
        to={`${ROUTES.assessments}?class_subject_id=${c.class_subject_id}`}
        size="small"
        startIcon={<AssignmentOutlinedIcon fontSize="small" />}
        aria-label={`See assessments for ${c.subject?.name ?? c.name}`}
      >
        Assessments
      </Button>
    ) : null;

  const isPast = Boolean(selectedPeriod && !selectedPeriod.isActiveYear);

  return (
    <Box>
      <PageHeader
        title={strings.nav.myClasses}
        subtitle={
          isPast
            ? `The subject classes you took in ${selectedPeriod?.yearName}.`
            : 'Every subject class you take. Each has its own teacher, room and times.'
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
          label={isPast ? 'Classes taken' : 'Classes I take'}
          value={classes.length}
          icon={<MenuBookIcon />}
          color="primary"
        />
        <StatCard
          label="On my timetable"
          value={`${scheduledCount}/${classes.length}`}
          icon={<ScheduleIcon />}
          color={scheduledCount === classes.length ? 'success' : 'warning'}
          helperText={
            scheduledCount === classes.length
              ? 'All classes have times'
              : 'Some classes have no times yet'
          }
        />
      </Box>

      <DataTable<ClassListItem>
        caption="The subject classes I take"
        columns={columns}
        rows={classes}
        getRowId={(c) => c.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={0}
        pageSize={100}
        total={classes.length}
        rowsPerPageOptions={[100]}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle="No classes yet"
        emptyDescription="Your subject classes will appear here once you're enrolled."
        rowActions={rowActions}
      />
    </Box>
  );
}

export default StudentClassesPage;
