import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { RoleRoute } from './RoleRoute';
import { ForbiddenPage, NotFoundPage } from './ErrorPages';
import { AppShell } from '@app/layout/AppShell';
import { ROUTES } from '@shared/constants/routes';
import type { ModuleKey } from '@shared/auth/permissions';

import { LoginPage, ChangePasswordPage } from '@features/auth/routes';
import { DashboardPage } from '@features/dashboard';
import { StudentsPage } from '@features/students';
import { TeachersPage } from '@features/teachers';
import { ClassesPage } from '@features/classes';
import { AssessmentsPage } from '@features/assessments';
import { GradesPage } from '@features/grades';
import { AttendancePage } from '@features/attendance';
import { AnnouncementsPage } from '@features/announcements';
import { ReportsPage } from '@features/reports';
import { SettingsPage } from '@features/settings';
import { ModulePlaceholder } from '@shared/components/ModulePlaceholder';

import type { ReactElement } from 'react';

/* eslint-disable react-refresh/only-export-components -- route module exports both the router and a small local page */

/** Student-only "My Profile" placeholder (ui-design-system §6 `/me`). */
function MyProfilePage() {
  return <ModulePlaceholder module="profile" title="My Profile" />;
}

/** Wrap a module page in its role guard (UX hiding; server is authoritative). */
function guarded(module: ModuleKey, element: ReactElement): ReactElement {
  return <RoleRoute module={module}>{element}</RoleRoute>;
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
      { path: ROUTES.dashboard, element: guarded('dashboard', <DashboardPage />) },
      { path: `${ROUTES.students}/*`, element: guarded('students', <StudentsPage />) },
      { path: `${ROUTES.teachers}/*`, element: guarded('teachers', <TeachersPage />) },
      { path: `${ROUTES.classes}/*`, element: guarded('classes', <ClassesPage />) },
      { path: `${ROUTES.assessments}/*`, element: guarded('assessments', <AssessmentsPage />) },
      { path: `${ROUTES.grades}/*`, element: guarded('grades', <GradesPage />) },
      { path: `${ROUTES.attendance}/*`, element: guarded('attendance', <AttendancePage />) },
      {
        path: `${ROUTES.announcements}/*`,
        element: guarded('announcements', <AnnouncementsPage />),
      },
      { path: `${ROUTES.reports}/*`, element: guarded('reports', <ReportsPage />) },
      { path: `${ROUTES.settings}/*`, element: guarded('settings', <SettingsPage />) },
      { path: ROUTES.myProfile, element: guarded('profile', <MyProfilePage />) },
      { path: ROUTES.forbidden, element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
