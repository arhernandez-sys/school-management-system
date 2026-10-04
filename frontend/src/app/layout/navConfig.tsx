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
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import PersonIcon from '@mui/icons-material/PersonOutline';

import type { Role } from '@shared/types/enums';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import type { ModuleKey } from '@shared/auth/permissions';
import { canAccessModule } from '@shared/auth/permissions';
import { ROUTES, type RoutePath } from '@shared/constants/routes';
import { strings } from '@i18n/strings';

export interface NavItem {
  module: ModuleKey;
  label: string;
  path: RoutePath;
  icon: ReactNode;
  /**
   * D44 — a collapsible group. The FIRST nested nav in this app.
   *
   * The parent is itself a real destination (`/courses`), not a bare toggle: collapsing a
   * link that goes somewhere into a thing that only opens a drawer costs a click for no
   * reason. Expanding is what reveals the children; clicking still navigates.
   *
   * ⚠️ THE PARENT STAYS HIGHLIGHTED WHILE A CHILD IS ACTIVE. `Sidebar`'s selection rule
   * is path-prefix based, and `/offerings` is not under `/courses`, so the parent's
   * `selected` is computed from its children too — which is also exactly what was asked
   * for ("it shows only courses highlighted").
   */
  children?: NavItem[];
}

export interface NavSection {
  /** Group heading (overline) — design-system §3.2. */
  heading: string;
  items: NavItem[];
}

const { nav, navGroups } = strings;

/**
 * Full nav definition, grouped per design-system §3.2. Labels are resolved per
 * role at build time (e.g. a student sees "My Courses" where staff see "Course
 * Offerings"). The actual visible set is computed by filtering on the permission map.
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
        // D44 — the catalog moved out of Settings. A student never sees it (the `courses`
        // module is `'none'` for them); they get their own offerings item below instead,
        // labelled "My Courses", because for a student the offerings they take simply ARE
        // their courses and a catalog is not a thing they browse.
        ...(isStudent
          ? []
          : [
              {
                module: 'courses' as ModuleKey,
                label: nav.courses,
                path: ROUTES.courses,
                icon: <MenuBookIcon />,
                children: [
                  {
                    module: 'offerings' as ModuleKey,
                    label: nav.offerings,
                    path: ROUTES.offerings,
                    icon: <ClassIcon />,
                  },
                ],
              },
              {
                // ⚠️ GATED ON `courses`, NOT ON `programs`. `PERMISSION_MATRIX` gives
                // `programs` capability `view-all` to EVERY role — including Lecturers and
                // Students — so keying this on its own module would put Programmes in
                // their menu. `features/settings/index.tsx` documents the same trap; it is
                // why the Settings tab was keyed this way too.
                module: 'courses' as ModuleKey,
                label: nav.programs,
                path: ROUTES.programs,
                icon: <AccountTreeIcon />,
              },
            ]),
        // D44 — a STUDENT keeps the flat item, labelled "My Courses"; staff reach Course
        // Offerings through the Courses group above, where a second flat copy would be a
        // duplicate entry pointing at the same route.
        ...(isStudent
          ? [
              {
                module: 'offerings' as ModuleKey,
                label: nav.myCourses,
                path: ROUTES.offerings,
                icon: <ClassIcon />,
              },
            ]
          : []),
        {
          // Directly after Course Offerings: the two answer "what do I take / teach" and
          // "when and where is it", and are the pair a student uses most.
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
        // D45 §46/§53. Sits under Insights rather than Settings: an auditor reads it as a
        // report, not as configuration, and it is the only screen the Auditor role exists
        // for. `module: 'audit'` keeps it off every nav that cannot reach it.
        { module: 'audit', label: nav.audit, path: ROUTES.audit, icon: <HistoryIcon /> },
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
  //
  // D44 — the filter now descends into `children`. Without the descent a child would be
  // shown to a role that cannot open it, which is the one thing this function exists to
  // prevent.
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => canAccessModule(role, item.module))
        .map((item) =>
          item.children
            ? {
                ...item,
                children: item.children.filter((child) =>
                  canAccessModule(role, child.module),
                ),
              }
            : item,
        ),
    }))
    .filter((section) => section.items.length > 0);
}

/** Runtime facts, beyond the caller's role, that change what the nav should show. */
export interface NavOptions {
  /**
   * D32 (brief §4) — the Dean's `assessment_policies.students_can_view_grades`, as it
   * arrives on `CurrentUser`. Only affects STUDENTS: with grades unpublished the
   * "My Grades" item is dropped rather than left pointing at a screen that 403s.
   *
   * Defaults to `true` so a caller that has not been updated keeps today's nav rather
   * than silently losing an item; the server is the boundary either way.
   */
  studentsCanViewGrades?: boolean;
}

export function navSectionsForRole(role: Role, options: NavOptions = {}): NavSection[] {
  const { studentsCanViewGrades = true } = options;
  const sections = buildSections(role);
  if (role !== 'student' || studentsCanViewGrades) return sections;

  // Drop the grades item, then any section it emptied — the same two-step
  // `buildSections` already does for role filtering, so a section never renders as a
  // bare heading.
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.module !== 'grades'),
    }))
    .filter((section) => section.items.length > 0);
}
