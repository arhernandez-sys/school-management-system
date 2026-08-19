/**
 * Role-aware navigation configuration (ui-design-system.md §3.2).
 *
 * The Sidebar renders sections → items filtered by the permission map. Hidden ≠
 * secured — every route also passes a guard and the server re-checks (NFR-SEC-01).
 *
 * Each item maps to a ModuleKey so visibility derives from PERMISSION_MATRIX, and
 * to a route path. Student items use possessive labels (§3.2).
 */

import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import PeopleIcon from '@mui/icons-material/PeopleOutline';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import SchoolIcon from '@mui/icons-material/SchoolOutlined';
import ClassIcon from '@mui/icons-material/ClassOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import AssignmentIcon from '@mui/icons-material/AssignmentOutlined';
import GradeIcon from '@mui/icons-material/GradingOutlined';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import CampaignIcon from '@mui/icons-material/CampaignOutlined';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonthOutlined';
import AssessmentIcon from '@mui/icons-material/AssessmentOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import PersonIcon from '@mui/icons-material/PersonOutline';

import type { Role } from '@shared/types/enums';
import type { ModuleKey } from '@shared/auth/permissions';
import { canAccessModule } from '@shared/auth/permissions';
import { ROUTES, type RoutePath } from '@shared/constants/routes';
import { strings } from '@i18n/strings';

export interface NavItem {
  module: ModuleKey;
  label: string;
  path: RoutePath;
  icon: ReactNode;
}

export interface NavSection {
  /** Group heading (overline) — design-system §3.2. */
  heading: string;
  items: NavItem[];
}

const { nav, navGroups } = strings;

/**
 * Full nav definition, grouped per design-system §3.2. Labels are resolved per
 * role at build time (e.g. Student sees "My Classes"). The actual visible set is
 * computed by filtering on the permission map.
 */
function buildSections(role: Role): NavSection[] {
  const isStudent = role === 'student';

  const sections: NavSection[] = [
    {
      heading: navGroups.overview,
      items: [
        { module: 'dashboard', label: nav.dashboard, path: ROUTES.dashboard, icon: <DashboardIcon /> },
      ],
    },
    {
      heading: isStudent ? navGroups.mySchool : navGroups.people,
      items: [
        { module: 'students', label: nav.students, path: ROUTES.students, icon: <PeopleIcon /> },
        {
          // Directly above Students, because that is the order the work happens in: an
          // applicant becomes a student, and acceptance is the step between (D30 §D11).
          module: 'applications',
          label: nav.admissions,
          path: ROUTES.applications,
          icon: <HowToRegIcon />,
        },
        { module: 'teachers', label: nav.teachers, path: ROUTES.teachers, icon: <SchoolIcon /> },
      ],
    },
    {
      heading: role === 'teacher' ? navGroups.myTeaching : navGroups.academics,
      items: [
        {
          module: 'classes',
          label: isStudent ? nav.myClasses : nav.classes,
          path: ROUTES.classes,
          icon: <ClassIcon />,
        },
        {
          // Directly after Classes: the two answer "what do I take / teach" and "when and
          // where is it", and are the pair a student uses most (D29).
          module: 'timetable',
          label: nav.myTimetable,
          path: ROUTES.timetable,
          icon: <ScheduleIcon />,
        },
        {
          module: 'assessments',
          label: nav.assessments,
          path: ROUTES.assessments,
          icon: <AssignmentIcon />,
        },
        {
          module: 'grades',
          label: isStudent ? nav.myGrades : nav.grades,
          path: ROUTES.grades,
          icon: <GradeIcon />,
        },
        {
          module: 'attendance',
          label: isStudent ? nav.myAttendance : nav.attendance,
          path: ROUTES.attendance,
          icon: <EventAvailableIcon />,
        },
      ],
    },
    {
      heading: navGroups.communication,
      items: [
        {
          module: 'announcements',
          label: nav.announcements,
          path: ROUTES.announcements,
          icon: <CampaignIcon />,
        },
        {
          module: 'calendar',
          label: nav.calendar,
          path: ROUTES.calendar,
          icon: <CalendarMonthIcon />,
        },
      ],
    },
    {
      heading: navGroups.insights,
      items: [
        { module: 'reports', label: nav.reports, path: ROUTES.reports, icon: <AssessmentIcon /> },
      ],
    },
    {
      heading: isStudent || role === 'teacher' ? navGroups.account : navGroups.admin,
      items: [
        { module: 'profile', label: nav.myProfile, path: ROUTES.myProfile, icon: <PersonIcon /> },
        { module: 'settings', label: nav.settings, path: ROUTES.settings, icon: <SettingsIcon /> },
      ],
    },
  ];

  // Filter to modules the role can access; drop now-empty sections.
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessModule(role, item.module)),
    }))
    .filter((section) => section.items.length > 0);
}

export function navSectionsForRole(role: Role): NavSection[] {
  return buildSections(role);
}
