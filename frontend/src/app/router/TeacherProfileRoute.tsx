import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { TeacherProfileView } from '@features/teachers/components/TeacherProfileView';
import { ROUTES } from '@shared/constants/routes';

/**
 * Guard + resolver for `/teacher/:teacherId` — the single teacher profile reachable by
 * roles WITHOUT the teachers directory (teacher self-view, student read-only view). It
 * sits inside the protected AppShell but NOT behind the teachers-module gate, so it does
 * its OWN per-role gating here:
 *  - principal / secretary → `manage` (full actions; same as the directory detail page).
 *  - teacher → `self` ONLY on their own profile; any other id → /forbidden.
 *  - student → /forbidden. Product decision (2026-07): students no longer have access to
 *    teacher profiles.
 *  - any other role → /forbidden.
 *
 * ⚠️ SECURITY: this is UX routing only. The server re-checks role + the ownership
 * relationship on every GET /teachers/{id} (NFR-SEC-01) — never rely on this guard to
 * protect teacher data.
 */
export function TeacherProfileRoute() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const { user } = useAuth();

  if (!user) {
    return <Navigate to={ROUTES.login} replace />;
  }
  if (!teacherId) {
    return <Navigate to={ROUTES.forbidden} replace />;
  }

  switch (user.role) {
    case 'principal':
    case 'secretary':
      return <TeacherProfileView teacherId={teacherId} mode="manage" />;
    // D43 — an Auditor reads any lecturer's profile, but in `view` mode: `manage` is
    // what renders the edit affordances, and offering them a Save button that the server
    // refuses on every verb is worse than not offering one.
    case 'auditor':
      return <TeacherProfileView teacherId={teacherId} mode="readonly" />;
    // D43 — an HOD is a lecturer, so their OWN profile is `self`; anyone else's they
    // read. Falling to `default` here would have denied a head their own profile page.
    case 'hod':
      return teacherId === user.teacher_profile_id ? (
        <TeacherProfileView teacherId={teacherId} mode="self" />
      ) : (
        <TeacherProfileView teacherId={teacherId} mode="readonly" />
      );
    case 'teacher':
      return teacherId === user.teacher_profile_id ? (
        <TeacherProfileView teacherId={teacherId} mode="self" />
      ) : (
        <Navigate to={ROUTES.forbidden} replace />
      );
    case 'student':
    default:
      return <Navigate to={ROUTES.forbidden} replace />;
  }
}

export default TeacherProfileRoute;
