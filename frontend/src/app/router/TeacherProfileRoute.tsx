import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useMyGrades } from '@features/grades/hooks/useGrades';
import { useClassesList, useClassSubjects } from '@features/classes/hooks/useClasses';
import { TeacherProfileView } from '@features/teachers/components/TeacherProfileView';
import { LoadingState } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';

/**
 * Guard + resolver for `/teacher/:teacherId` — the single teacher profile reachable by
 * roles WITHOUT the teachers directory (teacher self-view, student read-only view). It
 * sits inside the protected AppShell but NOT behind the teachers-module gate, so it does
 * its OWN per-role gating here:
 *  - principal / secretary → `manage` (full actions; same as the directory detail page).
 *  - teacher → `self` ONLY on their own profile; any other id → /forbidden.
 *  - student → `readonly` ONLY if the teacher teaches one of the student's subjects; the
 *    subject-teacher set is resolved from the student's data (see {@link StudentTeacherGate}).
 *  - any other role → /forbidden.
 *
 * ⚠️ SECURITY: this is UX routing only. The server re-checks role + the ownership /
 * subject-scoping relationship on every GET /teachers/{id} (NFR-SEC-01) — never rely on
 * this guard to protect teacher data.
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
    case 'teacher':
      return teacherId === user.teacher_profile_id ? (
        <TeacherProfileView teacherId={teacherId} mode="self" />
      ) : (
        <Navigate to={ROUTES.forbidden} replace />
      );
    case 'student':
      return <StudentTeacherGate teacherId={teacherId} />;
    default:
      return <Navigate to={ROUTES.forbidden} replace />;
  }
}

/**
 * Student-only resolver: a student may view a teacher READ-ONLY only when that teacher
 * teaches one of the student's subjects. We build the allowed set from two sources and
 * union them so the check reflects ALL of the student's subjects — not just those with
 * released grades:
 *  - {@link useMyGrades} `by_subject[].teacher.id` — subjects with released grades.
 *  - the student's homeroom class_subjects (`GET /classes` → first/only section →
 *    `GET /classes/{id}/subjects` → `teachers[].id`) — every subject taught to them,
 *    including those with no released grades yet.
 *
 * Fails CLOSED: while any source is still resolving we hold on a loading state rather
 * than deciding on a partial set; an unknown teacher id → /forbidden.
 */
function StudentTeacherGate({ teacherId }: { teacherId: string }) {
  const gradesQuery = useMyGrades();
  const classesQuery = useClassesList({ sort: 'name' });
  const section = classesQuery.data?.items[0] ?? null;
  const subjectsQuery = useClassSubjects(section?.id);

  const resolving =
    gradesQuery.isLoading ||
    classesQuery.isLoading ||
    // subjects query only runs once a section is known; don't wait on a disabled query.
    (Boolean(section) && subjectsQuery.isLoading);

  if (resolving) {
    return <LoadingState variant="page" label="Loading teacher" />;
  }

  const allowedTeacherIds = new Set<string>();
  for (const subject of gradesQuery.data?.by_subject ?? []) {
    if (subject.teacher?.id) {
      allowedTeacherIds.add(subject.teacher.id);
    }
  }
  for (const classSubject of subjectsQuery.data ?? []) {
    for (const teacher of classSubject.teachers) {
      allowedTeacherIds.add(teacher.id);
    }
  }

  return allowedTeacherIds.has(teacherId) ? (
    <TeacherProfileView teacherId={teacherId} mode="readonly" />
  ) : (
    <Navigate to={ROUTES.forbidden} replace />
  );
}

export default TeacherProfileRoute;
