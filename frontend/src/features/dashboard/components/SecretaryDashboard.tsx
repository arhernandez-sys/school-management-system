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
import GroupsIcon from '@mui/icons-material/Groups';
import ClassIcon from '@mui/icons-material/Class';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import SchoolIcon from '@mui/icons-material/School';
import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import CampaignIcon from '@mui/icons-material/Campaign';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { StatCard, EmptyState } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type { SecretaryDashboard as SecretaryDashboardData } from '../types';
import { AnnouncementsList } from './AnnouncementsList';

export interface SecretaryDashboardProps {
  data: SecretaryDashboardData;
}

function formatDate(iso: string): string {
  // D39 (Meeting #2 item 1) — day-first. Compact (no year): this is a dashboard chip.
  return formatSchoolDayMonth(iso);
}

const QUICK_ACTIONS = [
  // D38 — a student is created by ACCEPTING an application, so this tile leads to
  // Admissions rather than to the directory, which no longer has a create action.
  { label: 'Add student', to: ROUTES.applications, icon: <PersonAddAlt1Icon /> },
  { label: 'Add lecturer', to: ROUTES.teachers, icon: <SchoolIcon /> },
  { label: 'Create class', to: ROUTES.offerings, icon: <AddBusinessIcon /> },
  { label: 'Post announcement', to: ROUTES.announcements, icon: <CampaignIcon /> },
];

/**
 * Secretary dashboard (FR-DASH-03 — the records clerk's home). Unlike the Principal's
 * analytics view, this is task- and action-forward: quick links to add a student /
 * teacher / class, the setup tasks that need attention (unstaffed subjects, over-capacity
 * sections), and the most recent enrolments — the things a clerk actually works on.
 */
export function SecretaryDashboard({ data }: SecretaryDashboardProps) {
  const { stats } = data;

  return (
    <Grid container spacing={3}>
      {/* Quick actions — the headline of the clerk's day */}
      <Grid item xs={12}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h4" component="h3" gutterBottom>
              Quick actions
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
              {QUICK_ACTIONS.map((a) => (
                <Button
                  key={a.label}
                  component={RouterLink}
                  to={a.to}
                  variant="outlined"
                  startIcon={a.icon}
                  sx={{ flexGrow: { xs: 1, sm: 0 } }}
                >
                  {a.label}
                </Button>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      {/* Setup tasks + snapshot — every tile is a shortcut */}
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Active students"
          value={stats.active_students}
          icon={<GroupsIcon />}
          color="primary"
          to={ROUTES.students}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Sections"
          value={stats.total_sections}
          icon={<ClassIcon />}
          color="secondary"
          to={ROUTES.offerings}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Courses needing a lecturer"
          value={stats.unstaffed_subjects}
          icon={<WarningAmberIcon />}
          color={stats.unstaffed_subjects > 0 ? 'warning' : 'success'}
          helperText={stats.unstaffed_subjects > 0 ? 'Assign a lecturer' : 'All staffed'}
          to={ROUTES.offerings}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Sections over capacity"
          value={stats.over_capacity_sections}
          icon={<WarningAmberIcon />}
          color={stats.over_capacity_sections > 0 ? 'warning' : 'success'}
          helperText={stats.over_capacity_sections > 0 ? 'Review enrolment' : 'Within capacity'}
          to={ROUTES.offerings}
        />
      </Grid>

      {/* Recent enrollments — the clerk's working log */}
      <Grid item xs={12} lg={7}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <CardContent>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
              <Typography variant="h4" component="h3">
                Recent enrollments
              </Typography>
              <Button component={RouterLink} to={ROUTES.students} size="small">
                All students
              </Button>
            </Stack>
            {data.recent_enrollments.length === 0 ? (
              <EmptyState
                icon={<HowToRegIcon fontSize="inherit" />}
                title="No enrollments yet"
                description="Students you enroll will show up here."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {data.recent_enrollments.map((e, i) => (
                  <Box key={e.enrollment_id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem
                      sx={{ px: 0, py: 1.25, gap: 1 }}
                      secondaryAction={
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(e.enrolled_at)}
                        </Typography>
                      }
                    >
                      <Stack sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {e.student_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {e.offering_label}
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
      <Grid item xs={12} lg={5}>
        <AnnouncementsList
          title={`Announcements${
            stats.unread_announcements > 0 ? ` (${stats.unread_announcements} unread)` : ''
          }`}
          announcements={data.recent_announcements}
        />
      </Grid>
    </Grid>
  );
}

export default SecretaryDashboard;
