import { Card, CardContent, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import ClassIcon from '@mui/icons-material/Class';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import SchoolIcon from '@mui/icons-material/School';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import CoPresentIcon from '@mui/icons-material/CoPresent';
import { StatCard, ChartWithTable } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type {
  AdminDashboard as AdminDashboardData,
  AuditorDashboard as AuditorDashboardData,
} from '../types';
import { AnnouncementsList } from './AnnouncementsList';
import { PeopleListCard } from './PeopleListCard';

export interface AdminDashboardProps {
  /** D43 — also accepts the Auditor variant: the same school-wide payload, read-only. */
  data: AdminDashboardData | AuditorDashboardData;
}

/**
 * Dean dashboard (design-system §7.2 — school-wide analytics), and §42's KPI set.
 *
 * **D45 Phase 8 — THE TILES ARE NOW GROUPED, and the grouping is the design.** §42 names
 * a dozen indicators. Twelve equal tiles in one undifferentiated grid is a wall of
 * numbers nobody reads, so they are three labelled bands that answer three different
 * questions:
 *
 *  1. **The college** — how big is it, and is it turning up? Students (with seats-filled
 *     progress), new intake, courses, lecturers, programmes, attendance rate.
 *  2. **Needs attention** — what should the Dean DO today? Applicants waiting, accepted
 *     students not yet enrolled, students below the attendance floor, marking
 *     outstanding. Every one of these is a work queue, and each links to the screen that
 *     clears it: a KPI you cannot act from is decoration.
 *  3. **Outcomes** — graduates to date and the session's failure rate, with a
 *     worst-courses table beside the charts.
 *
 * **⚠️ FOUR OF THESE TILES WERE ALREADY BEING COMPUTED BY THE SERVER and this component
 * never rendered them** (`new_applicants`, `accepted_applicants`, `active_programmes`,
 * `students_at_risk`) — the frontend type could not even express them, so nothing failed
 * to say so. That is the reason the type now declares them as REQUIRED rather than
 * optional.
 *
 * **What §42 asks for and is NOT here:** "students on probation" needs Academic Standing
 * (deferred, C1) and "graduation candidates" needs the Graduation Audit (C2). Neither is
 * faked with a zero — a tile is a claim, and 0 for a feature that does not exist is a
 * number the Dean would believe.
 *
 * The older optional fields (new_students_term, total_courses, student_capacity,
 * enrollment_trend, recent_teachers, recent_students) stay defaulted here, so the
 * real-backend path is safe if a server has not shipped them yet.
 */
export function AdminDashboard({ data }: AdminDashboardProps) {
  const { stats } = data;

  // D31: bucketed by PROGRAMME, not by Form. The bar label is the programme CODE
  // ("BMAD") — a chart axis has no room for "Business Administration", and the code is
  // what BAJC prints on a report card anyway.
  const enrollmentData = data.enrollment_by_programme.map((d) => ({
    name: d.programme_code,
    value: d.count,
  }));
  const gradeData = data.grade_distribution.map((d) => ({ name: d.letter, value: d.count }));
  const trendData = (data.enrollment_trend ?? []).map((d) => ({ name: d.period, value: d.count }));

  const capacity = stats.student_capacity ?? 0;
  const seatsFilled =
    capacity > 0 ? Math.round((stats.active_students / capacity) * 100) : undefined;

  const teachers = data.recent_teachers ?? [];
  const students = data.recent_students ?? [];

  const failureRate = stats.failure_rate ?? 0;
  const worstCourses = data.course_failure_rates ?? [];

  return (
    <Grid container spacing={3}>
      {/* ── Band 1: the college ─────────────────────────────────────────────── */}
      <Grid item xs={12}>
        <Typography variant="overline" color="text.secondary">
          The college
        </Typography>
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Total students"
          value={stats.active_students}
          icon={<GroupsIcon />}
          color="primary"
          progress={seatsFilled}
          progressLabel={
            capacity > 0 ? `${stats.active_students} of ${capacity} seats filled` : undefined
          }
          to={ROUTES.students}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="New students"
          value={stats.new_students_term ?? 0}
          icon={<PersonAddAlt1Icon />}
          color="info"
          helperText="New to school this session"
          to={ROUTES.students}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Courses"
          value={stats.total_courses ?? stats.total_sections}
          icon={<ClassIcon />}
          color="secondary"
          helperText={`Across ${stats.total_sections} sections`}
          to={ROUTES.offerings}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Lecturers"
          value={stats.active_teachers}
          icon={<CoPresentIcon />}
          color="secondary"
          helperText="Active teaching staff"
          to={ROUTES.teachers}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Programmes"
          value={stats.active_programmes}
          icon={<AccountTreeIcon />}
          color="primary"
          helperText="Currently offered"
          to={ROUTES.programs}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Attendance rate"
          value={`${stats.attendance_rate}%`}
          icon={<EventAvailableIcon />}
          color="success"
          progress={stats.attendance_rate}
          progressLabel="College-wide, current session"
          to={ROUTES.attendance}
        />
      </Grid>

      {/* ── Band 2: needs attention ─────────────────────────────────────────────
          Every tile here is a WORK QUEUE and every one links to the screen that
          clears it. A KPI you cannot act from is decoration. */}
      <Grid item xs={12}>
        <Typography variant="overline" color="text.secondary">
          Needs attention
        </Typography>
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Applicants waiting"
          value={stats.new_applicants}
          icon={<AssignmentIndIcon />}
          color={stats.new_applicants > 0 ? 'warning' : 'success'}
          // Not a running total of everyone who ever applied — that would only ever go
          // up and would tell the Dean nothing to act on.
          helperText="Submitted, not yet decided"
          to={ROUTES.applications}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Accepted, not enrolled"
          value={stats.accepted_applicants}
          icon={<HowToRegIcon />}
          color={stats.accepted_applicants > 0 ? 'info' : 'success'}
          helperText="Registration still outstanding"
          to={ROUTES.applications}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Students at risk"
          value={stats.students_at_risk}
          icon={<WarningAmberIcon />}
          color={stats.students_at_risk > 0 ? 'error' : 'success'}
          // Distinct students, not alert rows: someone failing three classes is one
          // student at risk, and the server counts them that way.
          helperText="Below the attendance floor"
          to={ROUTES.attendance}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Marking outstanding"
          value={stats.outstanding_grade_submissions}
          icon={<PendingActionsIcon />}
          color={stats.outstanding_grade_submissions > 0 ? 'warning' : 'success'}
          helperText="Assessments still being marked"
          to={ROUTES.grades}
        />
      </Grid>

      {/* ── Band 3: outcomes ─────────────────────────────────────────────────── */}
      <Grid item xs={12}>
        <Typography variant="overline" color="text.secondary">
          Outcomes
        </Typography>
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Graduates"
          value={stats.graduates}
          icon={<SchoolIcon />}
          color="success"
          // "To date", not "this year": `graduation_date` is unrecorded across the
          // register, so there is no year to scope by and the label must not imply one.
          helperText="To date"
          to={ROUTES.students}
        />
      </Grid>
      <Grid item xs={12} sm={6} lg={3}>
        <StatCard
          label="Failure rate"
          value={`${failureRate}%`}
          icon={<TrendingDownIcon />}
          color={failureRate > 0 ? 'error' : 'success'}
          progress={failureRate}
          // The denominator matters enough to print: on enrolments this figure would be
          // meaningless three weeks into a session.
          progressLabel="Of grades resolved this session"
        />
      </Grid>

      {/* Analytics row */}
      <Grid item xs={12} lg={4}>
        <ChartWithTable
          title="Enrollment by programme"
          type="bar"
          data={enrollmentData}
          categoryLabel="Grade"
          valueLabel="Students"
        />
      </Grid>
      <Grid item xs={12} lg={4}>
        <ChartWithTable
          title="Grade distribution"
          type="bar"
          data={gradeData}
          categoryLabel="Letter"
          valueLabel="Students"
        />
      </Grid>
      <Grid item xs={12} lg={4}>
        <ChartWithTable
          title="Enrollment trend"
          type="line"
          data={trendData}
          categoryLabel="Session"
          valueLabel="Students"
        />
      </Grid>

      {/* §42 "course failure rates". A TABLE, not a chart: the number beside the course
          is what the Dean acts on, and a bar chart of eight course codes makes the
          reader estimate the figure they were given exactly. Only courses with enough
          resolved grades to mean anything appear — the server drops the rest, because a
          list sorted by percentage would otherwise put a course with one graded student
          above a course with thirty and a real problem. */}
      {worstCourses.length > 0 && (
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>
                Courses by failure rate
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                This session, over grades that have resolved to a letter. Courses with
                only a handful of results are not ranked.
              </Typography>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Course</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell align="right">Results</TableCell>
                      <TableCell align="right">Failing</TableCell>
                      <TableCell align="right">Rate</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {worstCourses.map((c) => (
                      <TableRow key={c.course_code}>
                        <TableCell>{c.course_code}</TableCell>
                        <TableCell>{c.course_name}</TableCell>
                        <TableCell align="right">{c.results}</TableCell>
                        <TableCell align="right">{c.failing}</TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontWeight: 600, color: c.failure_rate > 0 ? 'error.main' : 'text.primary' }}
                        >
                          {c.failure_rate}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      )}

      {/* Lists row */}
      <Grid item xs={12} md={6} lg={4}>
        <PeopleListCard
          title="Lecturers"
          people={teachers}
          viewAllTo={ROUTES.teachers}
          emptyText="Teaching staff will appear here."
        />
      </Grid>
      <Grid item xs={12} md={6} lg={4}>
        <PeopleListCard
          title="Students"
          people={students}
          viewAllTo={ROUTES.students}
          emptyText="Enrolled students will appear here."
        />
      </Grid>
      <Grid item xs={12} md={6} lg={4}>
        <AnnouncementsList
          title={`Recent announcements${
            stats.unread_announcements > 0 ? ` (${stats.unread_announcements} unread)` : ''
          }`}
          announcements={data.recent_announcements}
        />
      </Grid>
    </Grid>
  );
}

export default AdminDashboard;
