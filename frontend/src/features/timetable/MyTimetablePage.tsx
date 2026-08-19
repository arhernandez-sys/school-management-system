import { Link as RouterLink } from 'react-router-dom';
import { Alert, AlertTitle, Box, Button, Stack, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHeader,
  StatCard,
} from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useSelectedYear } from '@app/providers/YearContext';
import { WeekTimetable } from './components/WeekTimetable';
import { useMyTimetable } from './hooks/useTimetable';

/**
 * "My Timetable" — the caller's own Mon–Fri week (FR-SCH-03/04).
 *
 * One page for both audiences because the data and the layout are identical; only the copy
 * and whether teacher names are shown differ. `GET /timetable/me` is role-aware server-side:
 * a student gets the classes they are enrolled in, a teacher the classes they teach.
 *
 * This is the screen that makes the D29 model legible to a student: a homeroom model has
 * nothing to put on a Mon–Fri grid, because every lesson happens in the same room with the
 * same group. Here, Monday's Math and Tuesday's Biology are visibly different classes in
 * different rooms — and two students in the same year can hold different weeks.
 *
 * `unscheduled` is surfaced rather than dropped: a class with no meetings would otherwise be
 * invisible here while still appearing under My Classes, which reads as a bug to the user and
 * hides real missing data from the office.
 */
export function MyTimetablePage() {
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const { selectedYearId, selectedPeriod } = useSelectedYear();
  const query = useMyTimetable(selectedYearId);

  const view = query.data;
  const totalEntries = view?.days.reduce((n, d) => n + d.entries.length, 0) ?? 0;
  const busiestDay = view?.days.reduce<{ name: string; n: number }>(
    (best, d) => (d.entries.length > best.n ? { name: d.day_name, n: d.entries.length } : best),
    { name: '—', n: 0 },
  );
  const isPast = Boolean(selectedPeriod && !selectedPeriod.isActiveYear);

  return (
    <PageContainer>
      <PageHeader
        title="My Timetable"
        subtitle={
          isTeacher
            ? 'The classes you teach each week, with room and time.'
            : isPast
              ? `Your week in ${selectedPeriod?.yearName}.`
              : 'Where you need to be each day. Each subject class has its own room and time.'
        }
        primaryAction={
          !isTeacher ? (
            <Button
              component={RouterLink}
              to={ROUTES.classes}
              variant="outlined"
              startIcon={<ClassOutlinedIcon />}
            >
              My classes
            </Button>
          ) : undefined
        }
      />

      {query.isLoading && <LoadingState variant="cards" label="Loading your timetable" />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}

      {view && (
        <>
          {totalEntries === 0 && view.unscheduled.length === 0 ? (
            <EmptyState
              variant="page"
              title={isTeacher ? 'No classes scheduled' : 'Your timetable is empty'}
              description={
                isTeacher
                  ? 'Once your classes have meeting times, your week will appear here.'
                  : "Once you're enrolled in classes with meeting times, your week will appear here."
              }
            />
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  mb: 3,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                }}
              >
                <StatCard
                  label="Courses this week"
                  value={totalEntries}
                  icon={<MenuBookIcon />}
                  color="primary"
                />
                <StatCard
                  label="Busiest day"
                  value={busiestDay && busiestDay.n > 0 ? busiestDay.name : '—'}
                  icon={<ScheduleIcon />}
                  color="info"
                  helperText={
                    busiestDay && busiestDay.n > 0
                      ? `${busiestDay.n} ${busiestDay.n === 1 ? 'class' : 'classes'}`
                      : undefined
                  }
                />
              </Box>

              {view.unscheduled.length > 0 && (
                <Alert severity="info" sx={{ mb: 3 }}>
                  <AlertTitle>
                    {view.unscheduled.length === 1
                      ? '1 class has no times yet'
                      : `${view.unscheduled.length} classes have no times yet`}
                  </AlertTitle>
                  <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
                    {view.unscheduled.map((u) => (
                      <Typography key={u.class_id} component="li" variant="body2">
                        {u.subject.name} · {u.class_name}
                      </Typography>
                    ))}
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1 }}
                  >
                    {isTeacher
                      ? 'They will appear on your week once the office sets their times.'
                      : "You're enrolled — they'll appear here once the office sets their times."}
                  </Typography>
                </Alert>
              )}

              <WeekTimetable
                days={view.days}
                // A teacher's own week would repeat their name on every card.
                showTeacher={!isTeacher}
                emptyDayLabel={isTeacher ? 'No classes' : 'Free'}
              />
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}

export default MyTimetablePage;
