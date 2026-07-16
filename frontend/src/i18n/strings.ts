/**
 * i18n stub (NFR-LOC-01). English default. Phase 7 can swap this for a real i18n
 * library (e.g. i18next/react-intl). For the foundation we centralize the strings
 * the shell uses so feature work doesn't hardcode copy.
 *
 * Keep keys stable; values are the English source strings.
 */

export const strings = {
  app: {
    name: 'SIMS',
    fullName: 'School Information Management System',
    schoolName: 'Belize Adventist Junior College',
    skipToContent: 'Skip to main content',
  },
  nav: {
    dashboard: 'Dashboard',
    students: 'Students',
    teachers: 'Teachers',
    classes: 'Classes',
    assessments: 'Assessments',
    grades: 'Grades',
    attendance: 'Attendance',
    announcements: 'Announcements',
    calendar: 'Calendar',
    reports: 'Reports',
    settings: 'Settings',
    myProfile: 'My Profile',
    // Student possessive labels (design-system §3.2)
    myClasses: 'My Classes',
    myGrades: 'My Grades',
    myAttendance: 'My Attendance',
  },
  navGroups: {
    overview: 'Overview',
    people: 'People',
    academics: 'Academics',
    myTeaching: 'My Teaching',
    mySchool: 'My School',
    communication: 'Communication',
    insights: 'Insights',
    admin: 'Admin',
    account: 'Account',
  },
  auth: {
    signIn: 'Sign in',
    signInSubtitle: 'Sign in to continue',
    identifierLabel: 'Email or username',
    passwordLabel: 'Password',
    forgotPassword: 'Forgot password? Contact your school administrator.',
    invalidCredentials: 'Invalid credentials. Please try again.',
    logout: 'Log out',
    myAccount: 'My account',
  },
  common: {
    loading: 'Loading',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
  },
  errors: {
    forbiddenTitle: '403 — Forbidden',
    forbiddenBody: "You don't have permission to view this page.",
    notFoundTitle: '404 — Page not found',
    notFoundBody: "We couldn't find the page you were looking for.",
    backToDashboard: 'Back to dashboard',
  },
} as const;

export default strings;
