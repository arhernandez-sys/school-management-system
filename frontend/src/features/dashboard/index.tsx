import { PageHeader, LoadingState, ErrorState, EmptyState } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useDashboard } from './hooks/useDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { SecretaryDashboard } from './components/SecretaryDashboard';
import { TeacherDashboard } from './components/TeacherDashboard';
import { StudentDashboard } from './components/StudentDashboard';
import type { DashboardResponse } from './types';

/**
 * Dashboard feature (Phase 7 · DEMO). ONE role-aware page: the same DashboardPage is
 * mounted at ROUTES.dashboard for every role and renders the variant the composite
 * `GET /dashboard` returns, discriminated on `payload.role`. Role/scope are resolved
 * server-side (MSW handler) from the session — the page just picks the matching layout.
 *
 * Handles all four UI states: loading (skeleton), error (retry), empty (no active term),
 * and success (role variant).
 */
function renderVariant(data: DashboardResponse) {
  switch (data.role) {
    // D43 — an HOD lands on their own teaching, so their payload IS a lecturer's and the
    // lecturer layout is the right one. Pairing it with `teacher` here is not optional:
    // `default` below renders AdminDashboard, and a teacher-shaped payload has none of
    // its fields, so a head's dashboard would have come up empty or thrown.
    case 'teacher':
    case 'hod':
      return <TeacherDashboard data={data} />;
    case 'student':
      return <StudentDashboard data={data} />;
    case 'secretary':
      return <SecretaryDashboard data={data} />;
    // The Auditor's payload is the admin one, school-wide and read-only. Named rather
    // than left to `default` so the mapping is a decision on the page, not a fallthrough.
    case 'auditor':
    default:
      return <AdminDashboard data={data} />;
  }
}

export function DashboardPage() {
  const { user } = useAuth();
  const query = useDashboard(user?.role);

  const firstName = user?.full_name?.split(' ')[0] ?? '';
  const title = firstName ? `Welcome, ${firstName}` : 'Dashboard';

  const subtitle = query.data
    ? [query.data.academic_year_name, query.data.semester_name].filter(Boolean).join(' · ') ||
      undefined
    : undefined;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />

      {query.isLoading ? (
        <LoadingState variant="cards" rows={4} label="Loading your dashboard" />
      ) : query.isError ? (
        <ErrorState
          message="We couldn't load your dashboard. Please try again."
          onRetry={() => void query.refetch()}
        />
      ) : !query.data ? (
        <EmptyState
          title="Nothing to show yet"
          description="Your dashboard will appear once the school year is set up."
          variant="page"
        />
      ) : (
        renderVariant(query.data)
      )}
    </>
  );
}

export default DashboardPage;
