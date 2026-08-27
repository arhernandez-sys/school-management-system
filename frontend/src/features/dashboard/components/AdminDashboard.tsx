import { Grid } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import ClassIcon from '@mui/icons-material/Class';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import { StatCard, ChartWithTable } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type { AdminDashboard as AdminDashboardData } from '../types';
import { AnnouncementsList } from './AnnouncementsList';
import { PeopleListCard } from './PeopleListCard';

export interface AdminDashboardProps {
  data: AdminDashboardData;
}

/**
 * Principal dashboard (design-system §7.2 — school-wide analytics). Three responsive
 * bands, all real academic data (no finance — this app is academic-only):
 *
 *  1. KPI row (4-up lg → 2-up sm → 1-up xs): students (with seats-filled progress),
 *     new intake this term, active courses, and attendance rate (progress-backed).
 *  2. Analytics row (3-up lg → 1-up): enrollment-by-grade + grade-distribution bars and
 *     an enrollment-trend line — each an accessible ChartWithTable.
 *  3. Lists row (3-up lg → 2-up md → 1-up): a Teachers list, a Students list and the
 *     recent school-wide announcements.
 *
 * New fields (new_students_term, total_courses, student_capacity, enrollment_trend,
 * recent_teachers, recent_students) are optional on the type and defaulted here, so the
 * real-backend path stays safe if the server hasn't shipped them yet.
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

  return (
    <Grid container spacing={3}>
      {/* KPI row */}
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
          label="Attendance rate"
          value={`${stats.attendance_rate}%`}
          icon={<EventAvailableIcon />}
          color="success"
          progress={stats.attendance_rate}
          progressLabel="School-wide, current session"
          to={ROUTES.attendance}
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
