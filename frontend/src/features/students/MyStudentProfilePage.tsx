import { EmptyState, ErrorState, LoadingState, ProfileLayout } from '@shared/components';
import { useMyStudentRecord } from './hooks/useStudents';
import { StudentProfileSummary } from './components/StudentProfileSummary';
import { StudentEnrollmentPanel } from './components/StudentEnrollmentPanel';

/**
 * Student "My Profile" (`/me`, student role) — the student's OWN record, read-only.
 * Reads the self-scoped `GET /students/me` (no id needed; the server resolves the caller)
 * and reuses the same identity card + enrollment panel as the P/S/teacher student detail,
 * minus the edit/status/delete actions, year filter, and grades tab (a student's grades and
 * attendance live in their dedicated "My Grades" / "My Attendance" screens).
 */
export function MyStudentProfilePage() {
  const query = useMyStudentRecord(true);
  const detail = query.data;

  if (query.isLoading) {
    return <LoadingState variant="page" label="Loading your profile" />;
  }
  if (query.isError) {
    return <ErrorState onRetry={() => void query.refetch()} />;
  }
  if (!detail) {
    return (
      <EmptyState
        variant="page"
        title="No profile found"
        description="We couldn't find a student profile linked to your account."
      />
    );
  }

  return (
    <ProfileLayout
      title={detail.full_name}
      summary={<StudentProfileSummary student={detail} />}
    >
      <StudentEnrollmentPanel student={detail} />
    </ProfileLayout>
  );
}

export default MyStudentProfilePage;
