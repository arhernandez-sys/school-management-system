import {
  Box,
  Card,
  CardContent,
  Divider,
  Grid,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import GradeIcon from '@mui/icons-material/Grade';
import { formatSchoolDayMonth } from '@shared/utils/schoolDate';
import SchoolIcon from '@mui/icons-material/School';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import UpcomingIcon from '@mui/icons-material/Upcoming';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { StatCard, StatusBadge, EmptyState } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type { StudentDashboard as StudentDashboardData } from '../types';
import { AnnouncementsList } from './AnnouncementsList';

export interface StudentDashboardProps {
  data: StudentDashboardData;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'TBD';
  // D39 (Meeting #2 item 1) — day-first. Compact (no year): this is a dashboard chip.
  // `iso` here is a date-only `YYYY-MM-DD`, which the formatter reads as a calendar date
  // rather than as UTC midnight — the reason the old `T00:00:00Z` suffix is gone.
  return formatSchoolDayMonth(iso);
}

/** Map a letter grade to a status kind (passing letters read as success, F as error). */
function letterKind(letter: string): 'success' | 'warning' | 'error' {
  if (letter === 'F') return 'error';
  if (letter === 'D') return 'warning';
  return 'success';
}

/**
 * Student dashboard (design-system §7.2 — own data). GPA, term average and attendance
 * as StatCards, then current classes, recent RELEASED grades (unreleased is never sent),
 * upcoming assessments and targeted announcements.
 *
 * **GPA leads the row** (D30 §D5): at a junior college it is the figure the student is
 * actually judged on, and the one their report card prints. The term average stays
 * beside it because it is a different measure — a 0-100 percentage rather than a 0-4
 * credit-weighted figure — not a worse version of the same one.
 */
export function StudentDashboard({ data }: StudentDashboardProps) {
  const { stats } = data;

  const averageDisplay =
    stats.term_average != null
      ? `${stats.term_average}${stats.term_letter ? ` (${stats.term_letter})` : ''}`
      : '—';

  return (
    <Grid container spacing={3}>
      {/* Stat row — four tiles, so sm halves and md quarters rather than thirds. */}
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          label="Session GPA"
          value={stats.gpa != null ? stats.gpa.toFixed(2) : '—'}
          icon={<SchoolIcon />}
          color="primary"
          // StatCard's progress bar is a 0-100 scale, so a 0-4 GPA is scaled onto it.
          progress={stats.gpa != null ? (stats.gpa / 4) * 100 : undefined}
          helperText={
            stats.gpa == null
              ? 'No enrolled credits yet'
              : `Across ${stats.total_credits} enrolled credits`
          }
          to={ROUTES.grades}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          label="Session average"
          value={averageDisplay}
          icon={<GradeIcon />}
          color="info"
          progress={stats.term_average ?? undefined}
          helperText={stats.term_average == null ? 'No released grades yet' : 'Across your courses'}
          to={ROUTES.grades}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          label="Attendance"
          value={`${stats.attendance_rate}%`}
          icon={<EventAvailableIcon />}
          color="success"
          progress={stats.attendance_rate}
          to={ROUTES.attendance}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          label="Upcoming assessments"
          value={stats.upcoming_count}
          icon={<UpcomingIcon />}
          color="warning"
          to={ROUTES.assessments}
        />
      </Grid>

      {/* My classes */}
      <Grid item xs={12} md={6}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h4" component="h3" gutterBottom>
              My classes
            </Typography>
            {data.my_classes.length === 0 ? (
              <EmptyState
                icon={<MenuBookIcon fontSize="inherit" />}
                title="No classes yet"
                description="You aren't enrolled in any courses this session."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {data.my_classes.map((c, i) => (
                  <Box key={c.offering.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem sx={{ px: 0, py: 1.25 }}>
                      <Stack sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {c.offering.course.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {/* Label + lecturer: the label is what tells one section of a
                              course from another. */}
                          {[c.offering.label, c.teacher_name].filter(Boolean).join(' · ')}
                        </Typography>
                      </Stack>
                    </ListItem>
                  </Box>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* Recent released grades */}
      <Grid item xs={12} md={6}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h4" component="h3" gutterBottom>
              Recent grades
            </Typography>
            {data.recent_grades.length === 0 ? (
              <EmptyState
                icon={<GradeIcon fontSize="inherit" />}
                title="No released grades"
                description="Grades appear here once your lecturers release them."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {data.recent_grades.map((g, i) => (
                  <Box key={g.assessment_id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem
                      sx={{ px: 0, py: 1.25, gap: 1 }}
                      secondaryAction={<StatusBadge label={g.letter} kind={letterKind(g.letter)} />}
                    >
                      <Stack sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {g.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {g.offering?.course.name ?? '—'} · {g.score}/{g.max_score}
                        </Typography>
                      </Stack>
                    </ListItem>
                  </Box>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* Upcoming assessments */}
      <Grid item xs={12} md={6}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h4" component="h3" gutterBottom>
              Upcoming assessments
            </Typography>
            {data.upcoming_assessments.length === 0 ? (
              <EmptyState
                icon={<UpcomingIcon fontSize="inherit" />}
                title="Nothing scheduled"
                description="No upcoming assessments right now."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {data.upcoming_assessments.map((a, i) => (
                  <Box key={a.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem sx={{ px: 0, py: 1.25 }}>
                      <Stack sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {a.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {a.offering?.course.name ?? '—'} · {formatDate(a.assessment_date)}
                        </Typography>
                      </Stack>
                    </ListItem>
                  </Box>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* Announcements */}
      <Grid item xs={12} md={6}>
        <AnnouncementsList title="Announcements" announcements={data.announcements} />
      </Grid>
    </Grid>
  );
}

export default StudentDashboard;
