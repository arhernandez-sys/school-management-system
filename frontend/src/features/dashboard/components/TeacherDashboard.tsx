import { Link as RouterLink } from 'react-router-dom';
import { formatSchoolDayMonth } from '@shared/utils/schoolDate';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Grid,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import ClassIcon from '@mui/icons-material/Class';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import RuleIcon from '@mui/icons-material/Rule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { StatCard, StatusBadge, EmptyState } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type {
  TeacherDashboard as TeacherDashboardData,
  HodDashboard as HodDashboardData,
} from '../types';
import { AnnouncementsList } from './AnnouncementsList';

export interface TeacherDashboardProps {
  /** D43 — also accepts the HOD variant, which is the same payload with an honest
   *  discriminator. A head's landing page IS their own teaching. */
  data: TeacherDashboardData | HodDashboardData;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'TBD';
  // D39 (Meeting #2 item 1) — day-first. Compact (no year): this is a dashboard chip.
  // `iso` here is a date-only `YYYY-MM-DD`, which the formatter reads as a calendar date
  // rather than as UTC midnight — the reason the old `T00:00:00Z` suffix is gone.
  return formatSchoolDayMonth(iso);
}

/**
 * Deep link into the gradebook for one offering. The gradebook selects by
 * `?class_subject_id=` (a query param, not a path segment — see
 * `features/grades/GradeAssessmentsScreen.tsx`); with no id it opens the picker.
 */
function gradebookLink(offeringId?: string): string {
  return offeringId
    ? `${ROUTES.grades}?offering_id=${encodeURIComponent(offeringId)}`
    : ROUTES.grades;
}

/**
 * Teacher dashboard (design-system §7.2 — own classes, attendance-forward). The hero is
 * "today's classes" with a recorded / not-recorded status per section (FR-ATT-08), each
 * row deep-linking to the attendance sheet. Then upcoming/recent assessments and
 * targeted announcements.
 */
export function TeacherDashboard({ data }: TeacherDashboardProps) {
  const { stats } = data;

  return (
    <Grid container spacing={3}>
      {/* Stat row */}
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="My courses"
          value={stats.my_offerings}
          icon={<ClassIcon />}
          color="primary"
          to={ROUTES.offerings}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Attendance due today"
          value={stats.attendance_due_today}
          icon={<EventBusyIcon />}
          color={stats.attendance_due_today > 0 ? 'warning' : 'success'}
          helperText={stats.attendance_due_today > 0 ? 'Action needed' : 'All recorded'}
          to={ROUTES.attendance}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Ungraded items"
          value={stats.ungraded_items}
          icon={<RuleIcon />}
          color="info"
          helperText="Still to mark"
          to={ROUTES.grades}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        {/* Marked but not yet published — a DIFFERENT outstanding action from
            "ungraded items", so it gets its own tile rather than being folded in.
            Links to the offering with the oldest hidden work; falls back to the
            gradebook picker when the queue is empty. */}
        <StatCard
          label="Awaiting release"
          value={stats.awaiting_release_items}
          icon={<VisibilityOffIcon />}
          color={stats.awaiting_release_items > 0 ? 'warning' : 'success'}
          helperText={
            stats.awaiting_release_items > 0 ? 'Students cannot see these' : 'All released'
          }
          to={gradebookLink(data.awaiting_release[0]?.offering_id)}
        />
      </Grid>

      {/* Today's classes — hero */}
      <Grid item xs={12} lg={7}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h4" component="h3" gutterBottom>
              Today&apos;s classes
            </Typography>
            {data.today_classes.length === 0 ? (
              <EmptyState
                icon={<ClassIcon fontSize="inherit" />}
                title="No classes assigned"
                description="You have no course offerings in the active session yet."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {data.today_classes.map((c, i) => (
                  <Box key={c.offering.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem
                      sx={{ px: 0, py: 1.5, gap: 1, flexWrap: 'wrap' }}
                      secondaryAction={
                        <Button
                          component={RouterLink}
                          to={ROUTES.attendance}
                          size="small"
                          variant={c.attendance_recorded ? 'text' : 'contained'}
                          startIcon={
                            c.attendance_recorded ? <CheckCircleIcon /> : <WarningAmberIcon />
                          }
                        >
                          {c.attendance_recorded ? 'View' : 'Record'}
                        </Button>
                      }
                    >
                      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {c.offering.label} · {c.offering.course.name}
                        </Typography>
                        <StatusBadge
                          label={c.attendance_recorded ? 'Recorded' : 'Not recorded'}
                          kind={c.attendance_recorded ? 'success' : 'warning'}
                        />
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
      <Grid item xs={12} lg={5}>
        <AnnouncementsList title="Announcements" announcements={data.recent_announcements} />
      </Grid>

      {/* Awaiting release — the standing "marked but still hidden" queue. Rendered
          only when non-empty: an always-present empty card would add noise to the
          common case where a teacher releases as they mark. */}
      {data.awaiting_release.length > 0 && (
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
              >
                <Typography variant="h4" component="h3">
                  Awaiting release
                </Typography>
                <StatusBadge
                  label={`${stats.awaiting_release_items} to release`}
                  kind="warning"
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Marked, but students still cannot see these results.
              </Typography>
              <List disablePadding>
                {data.awaiting_release.map((a, i) => (
                  <Box key={a.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem
                      sx={{ px: 0, py: 1.25, gap: 1, flexWrap: 'wrap' }}
                      secondaryAction={
                        <Button
                          component={RouterLink}
                          to={gradebookLink(a.offering_id)}
                          size="small"
                          variant="contained"
                        >
                          Release
                        </Button>
                      }
                    >
                      <Stack sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {a.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {[a.offering?.label, a.offering?.course.name].filter(Boolean).join(' · ')}{' '}
                          · {a.graded_unreleased_count}{' '}
                          {a.graded_unreleased_count === 1 ? 'student' : 'students'} waiting
                        </Typography>
                      </Stack>
                    </ListItem>
                  </Box>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      )}

      {/* Upcoming / recent assessments */}
      <Grid item xs={12}>
        <Card variant="outlined">
          <CardContent>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
              <Typography variant="h4" component="h3">
                Assessments needing attention
              </Typography>
              <Button component={RouterLink} to={ROUTES.grades} size="small">
                Enter grades
              </Button>
            </Stack>
            {data.recent_assessments.length === 0 ? (
              <EmptyState
                icon={<RuleIcon fontSize="inherit" />}
                title="Nothing to grade"
                description="No published or in-progress assessments right now."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {data.recent_assessments.map((a, i) => (
                  <Box key={a.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem sx={{ px: 0, py: 1.25, gap: 1, flexWrap: 'wrap' }}>
                      <Stack sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {a.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {[a.offering?.label, a.offering?.course.name].filter(Boolean).join(' · ')}{' '}
                          · {formatDate(a.assessment_date)}
                        </Typography>
                      </Stack>
                      <StatusBadge
                        label={a.status === 'grading' ? 'In progress' : 'Published'}
                        kind={a.status === 'grading' ? 'warning' : 'info'}
                      />
                    </ListItem>
                  </Box>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

export default TeacherDashboard;
