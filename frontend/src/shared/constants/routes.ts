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
  teachers: '/teachers',
  classes: '/classes',
  assessments: '/assessments',
  grades: '/grades',
  attendance: '/attendance',
  announcements: '/announcements',
  reports: '/reports',
  settings: '/settings',
  myProfile: '/me',
  forbidden: '/forbidden',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
