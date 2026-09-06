/**
 * MSW handler registry — the single `handlers` array the worker registers.
 *
 * Each module owns ONE file (auth.ts, settings.ts, students.ts, …) that exports its
 * `<module>Handlers` array. This index concatenates them all. The order matters only
 * for overlapping routes (more specific paths should precede generic ones); within a
 * module MSW matches most-recently-registered first, but our routes don't overlap.
 *
 * ⚠️ MODULE AGENTS: you never need to edit THIS file. Your module's handler file is
 * already imported and spread below. Just fill in your `<module>Handlers` array.
 * (Adding a brand-new module? Then, and only then, add one import + one spread here.)
 */
import { readOnlyGuardHandlers } from './readOnlyGuard';
import { authHandlers } from './auth';
import { settingsHandlers } from './settings';
import { coursesHandlers } from './courses';
import { classroomsHandlers } from './classrooms';
import { programsHandlers } from './programs';
import { prerequisitesHandlers } from './prerequisites';
import { studentsHandlers } from './students';
import { admissionsHandlers, pendingApplicationsHandlers } from './admissions';
import { teachersHandlers } from './teachers';
import { offeringsHandlers } from './offerings';
import { assessmentsHandlers } from './assessments';
import { gradesHandlers } from './grades';
import { revisionsHandlers } from './revisions';
import { attendanceHandlers } from './attendance';
import { announcementsHandlers } from './announcements';
import { eventsHandlers } from './events';
import { dashboardHandlers } from './dashboard';
import { reportsHandlers } from './reports';
import { timetableHandlers } from './timetable';

export const handlers = [
  // D43 — FIRST, deliberately. MSW matches in array order and a resolver returning
  // `undefined` falls through, so this refuses an auditor's writes in front of every
  // module rather than each module remembering to. Mirrors the server, which enforces
  // the same rule once in `get_current_user`.
  ...readOnlyGuardHandlers,
  ...authHandlers,
  ...settingsHandlers,
  ...coursesHandlers,
  ...programsHandlers,
  ...classroomsHandlers,
  ...prerequisitesHandlers,
  ...studentsHandlers,
  ...admissionsHandlers,
  // D38 — declared AFTER the applications handlers, but the paths cannot collide: they are
  // a separate prefix (`/pending-applications`), which is why the server uses one too.
  ...pendingApplicationsHandlers,
  ...teachersHandlers,
  ...offeringsHandlers,
  ...assessmentsHandlers,
  ...gradesHandlers,
  ...revisionsHandlers,
  ...attendanceHandlers,
  ...announcementsHandlers,
  ...eventsHandlers,
  ...dashboardHandlers,
  ...reportsHandlers,
  ...timetableHandlers,
];
