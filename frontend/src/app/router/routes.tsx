import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { RoleRoute } from './RoleRoute';
import { ForbiddenPage, NotFoundPage } from './ErrorPages';
import { AppShell } from '@app/layout/AppShell';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { LoadingState } from '@shared/components';
import type { ModuleKey } from '@shared/auth/permissions';

import { LoginPage, ChangePasswordPage } from '@features/auth/routes';
import { ModulePlaceholder } from '@shared/components/ModulePlaceholder';

import type { ComponentType, ReactElement } from 'react';

/* eslint-disable react-refresh/only-export-components -- route module exports both the router and a small local page */

/**
 * ────────────────────────────────────────────────────────────────────────────────
 * ROLE-SCOPED CODE SPLITTING — a role downloads ONLY the screens it can reach.
 * ────────────────────────────────────────────────────────────────────────────────
 * Every feature module below is `lazy()`, so its JavaScript lives in a separate
 * chunk that the browser fetches on FIRST NAVIGATION to that route and never
 * before. Combined with the `RoleRoute` gate (see `lazyGuarded`), a student's
 * browser never receives the Students directory, the Teachers directory, Reports
 * or Settings-admin code at all — not hidden, not disabled: never sent.
 *
 * Before this, all eleven modules were STATIC imports, so every role downloaded a
 * single ~700 kB bundle containing every other role's screens on first load.
 *
 * ⚠️ THIS IS A PAYLOAD AND PERFORMANCE MEASURE, NOT A SECURITY BOUNDARY. Chunk
 * URLs are public; anyone can fetch a chunk directly. What actually protects data
 * is that the SERVER re-checks role + ownership on every call (NFR-SEC-01), and
 * that is unchanged. Not shipping the code narrows what an attacker can learn
 * about admin screens from a student's session, and cuts first-load cost for the
 * roles that matter most — but it protects no data on its own.
 *
 * ⚠️ ORDERING RULE, load-bearing: `RoleRoute` must wrap `Suspense`, never the
 * reverse. React only starts a lazy import when the component MOUNTS, so a role
 * without access redirects at the guard and the import is never triggered. Nest
 * them the other way and Suspense mounts first, fetching the chunk for a module
 * the user is about to be redirected away from — which is exactly the behaviour
 * this split exists to prevent.
 *
 * Deliberately kept EAGER (all small, and all on the critical path):
 *  - Login / ChangePassword — the first screen every visitor sees. Lazily loading
 *    it would add a round trip to the one page that must be fast.
 *  - AppShell, ProtectedRoute, RoleRoute, ErrorPages — the chrome and the guards
 *    themselves; they render on every route including the redirects.
 */
const DashboardPage = lazy(() => import('@features/dashboard'));
const StudentsPage = lazy(() => import('@features/students'));
const AdmissionsPage = lazy(() => import('@features/admissions'));
const TeachersPage = lazy(() => import('@features/teachers'));
const OfferingsPage = lazy(() => import('@features/offerings'));
const MyTimetablePage = lazy(() => import('@features/timetable/MyTimetablePage'));
const AssessmentsPage = lazy(() => import('@features/assessments'));
const GradesPage = lazy(() => import('@features/grades'));
const AttendancePage = lazy(() => import('@features/attendance'));
const AnnouncementsPage = lazy(() => import('@features/announcements'));
const CalendarPage = lazy(() => import('@features/calendar'));
const ReportsPage = lazy(() => import('@features/reports'));
const SettingsPage = lazy(() => import('@features/settings'));

// The two "My Profile" variants are split from each other as well as from the
// shell: a teacher must not pull in the student profile screen to see their own,
// and vice versa.
const TeacherProfileView = lazy(() => import('@features/teachers/components/TeacherProfileView'));
const MyStudentProfilePage = lazy(() => import('@features/students/MyStudentProfilePage'));
const TeacherProfileRoute = lazy(() => import('./TeacherProfileRoute'));

/** Fallback while a route chunk is in flight. Matches the app's own loading UX. */
function RouteFallback() {
  return <LoadingState variant="page" label="Loading" />;
}

/**
 * Wrap a module page in its role guard, then in Suspense.
 *
 * The nesting order is deliberate and must not be swapped — see the ORDERING RULE
 * in the block comment above.
 */
function lazyGuarded(module: ModuleKey, Component: ComponentType) {
  return (
    <RoleRoute module={module}>
      <Suspense fallback={<RouteFallback />}>
        <Component />
      </Suspense>
    </RoleRoute>
  );
}

/** Suspense wrapper for a lazy route that does its OWN gating (no module gate). */
function lazyOnly(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

/**
 * Role-aware "My Profile" (`/me`, ui-design-system §6), gated by the `profile` module:
 *  - teacher (with a linked teacher_profile_id) → their own {@link TeacherProfileView}
 *    in `self` mode (edit-profile only).
 *  - student → their own {@link MyStudentProfilePage} (read-only identity + enrollment).
 *  - principal/secretary never reach here — `profile` is 'none' for them, so the module
 *    gate redirects to /forbidden (their account lives under Settings).
 *
 * The role branch happens BEFORE the lazy component is referenced, so each role
 * fetches only its own variant.
 */
function MyProfilePage() {
  const { user } = useAuth();
  // D43 — an HOD is a lecturer and carries a `teacher_profile_id` (the server resolves
  // it for every role in `LECTURER_ROLES`), so "My profile" must reach their lecturer
  // profile. Without this they fell through to the placeholder — a head clicking their
  // own name would have got an empty page.
  if ((user?.role === 'teacher' || user?.role === 'hod') && user.teacher_profile_id) {
    return <TeacherProfileView teacherId={user.teacher_profile_id} mode="self" />;
  }
  if (user?.role === 'student') {
    return <MyStudentProfilePage />;
  }
  return <ModulePlaceholder module="profile" title="My Profile" />;
}

export const router = createBrowserRouter([
  // Public
  { path: ROUTES.login, element: <LoginPage /> },
  { path: ROUTES.changePassword, element: <ChangePasswordPage /> },

  // Authenticated app shell (bootstrap-aware guard wraps the whole layout)
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to={ROUTES.dashboard} replace /> },
      { path: ROUTES.dashboard, element: lazyGuarded('dashboard', DashboardPage) },
      { path: `${ROUTES.students}/*`, element: lazyGuarded('students', StudentsPage) },
      // D30 §D11 — Registrar + Dean. `lazyGuarded` keeps a Lecturer from even fetching
      // the chunk, which is the point of gating before the lazy reference.
      {
        path: `${ROUTES.applications}/*`,
        element: lazyGuarded('applications', AdmissionsPage),
      },
      { path: `${ROUTES.teachers}/*`, element: lazyGuarded('teachers', TeachersPage) },
      { path: `${ROUTES.offerings}/*`, element: lazyGuarded('offerings', OfferingsPage) },
      { path: ROUTES.timetable, element: lazyGuarded('timetable', MyTimetablePage) },
      { path: `${ROUTES.assessments}/*`, element: lazyGuarded('assessments', AssessmentsPage) },
      { path: `${ROUTES.grades}/*`, element: lazyGuarded('grades', GradesPage) },
      { path: `${ROUTES.attendance}/*`, element: lazyGuarded('attendance', AttendancePage) },
      {
        path: `${ROUTES.announcements}/*`,
        element: lazyGuarded('announcements', AnnouncementsPage),
      },
      { path: `${ROUTES.calendar}/*`, element: lazyGuarded('calendar', CalendarPage) },
      { path: `${ROUTES.reports}/*`, element: lazyGuarded('reports', ReportsPage) },
      { path: `${ROUTES.settings}/*`, element: lazyGuarded('settings', SettingsPage) },
      { path: ROUTES.myProfile, element: lazyGuarded('profile', MyProfilePage) },
      // Single teacher profile for roles without the directory (teacher self / student
      // read-only). NOT behind the teachers-module gate — TeacherProfileRoute does its
      // own per-role gating (and the server re-checks every call, NFR-SEC-01).
      {
        path: `${ROUTES.teacherProfile}/:teacherId`,
        element: lazyOnly(<TeacherProfileRoute />),
      },
      { path: ROUTES.forbidden, element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
