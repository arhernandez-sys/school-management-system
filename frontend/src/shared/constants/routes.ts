/**
 * Route path constants — single source of truth for navigation paths
 * (mirrors ui-design-system.md §6 sitemap). Used by the router, Sidebar nav map,
 * and guards so paths never drift between definition and links.
 */

export const ROUTES = {
  login: '/login',
  changePassword: '/login/change-password',
  dashboard: '/dashboard',
  students: '/students',
  /** Admissions — the application record and its decision (D30 §D11). */
  applications: '/applications',
  teachers: '/teachers',
  /**
   * **D31** — was `/classes`. A route path is user-visible (bookmarks, the address bar,
   * shared links), so leaving `/classes` on a screen titled "Course Offerings" would be
   * the one place the retired homeroom noun still showed.
   */
  /**
   * D44 — Courses and Programmes left Settings for the main menu. They were
   * `/settings/courses` and `/settings/programs`, which is where the CATALOG lived
   * because nothing else claimed it; the client asked for them where the work is.
   *
   * The old paths still resolve — `features/settings/index.tsx` redirects them — so
   * existing bookmarks and the links in older report pages keep working.
   */
  courses: '/courses',
  programs: '/programs',
  offerings: '/offerings',
  /** Student / teacher Mon–Fri week, built from offering meetings. */
  timetable: '/timetable',
  assessments: '/assessments',
  grades: '/grades',
  /** Per-assessment class grading page: /grades/assessment/:assessmentId. */
  gradeAssessment: '/grades/assessment',
  /** Grade-revision queue (D30 §D7) — the Dean decides, the Lecturer tracks their own. */
  gradeRevisions: '/grades/revisions',
  attendance: '/attendance',
  announcements: '/announcements',
  calendar: '/calendar',
  reports: '/reports',
  settings: '/settings',
  myProfile: '/me',
  /** Single teacher profile reachable by teacher (own) / student (subject teacher). */
  teacherProfile: '/teacher',
  forbidden: '/forbidden',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
