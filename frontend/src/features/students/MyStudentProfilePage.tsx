import { EmptyState, ErrorState, LoadingState, ProfileLayout } from '@shared/components';
import { useSelectedYear } from '@app/providers/YearContext';
import { useMyStudentRecord } from './hooks/useStudents';
import { StudentProfileSummary } from './components/StudentProfileSummary';
import { StudentEnrollmentPanel } from './components/StudentEnrollmentPanel';

/**
 * Student "My Profile" (`/me`, student role) — the student's OWN record, read-only.
 * Reads the self-scoped `GET /students/me` (no id needed; the server resolves the caller)
 * and reuses the same identity card + enrollment panel as the P/S/teacher student detail,
 * minus the edit/status/delete actions and the grades tab (a student's grades and
 * attendance live in their dedicated "My Grades" / "My Attendance" screens).
 *
 * ── It follows the global year·semester switcher ────────────────────────────────────
 * There is deliberately NO year picker on this page: unlike staff's `StudentDetailPage`
 * (which owns a local `?year=` filter because staff browse many students), a student's
 * period is chosen once in the top bar and applies everywhere. This page used to ignore
 * it entirely — it called `/students/me` with no params — so the header kept showing the
 * CURRENT section while My Grades, My Classes and My Attendance had all moved to the
 * selected year. The student sits in a different section each year, so the profile
 * contradicted every other screen.
 *
 * Only the YEAR is sent: enrollment and sections are year-keyed, not semester-keyed
 * (`sections.academic_year_id`), so a semester would narrow nothing here.
 */
export function MyStudentProfilePage() {
  const { selectedYearId, periods, selectedPeriod } = useSelectedYear();
  const query = useMyStudentRecord(true, selectedYearId);
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
      {/* `yearName` drives the panel's "not enrolled in {year}" empty copy. Only passed
          when there is more than one period to choose from — with a single year the
          phrase would name the only year that exists and read as noise. */}
      <StudentEnrollmentPanel
        student={detail}
        yearName={periods.length > 1 ? selectedPeriod?.yearName : undefined}
        // A student cannot open a class's detail page (it exposes the roster), so the class
        // chips are plain text here rather than dead links.
        linkClasses={false}
      />
    </ProfileLayout>
  );
}

export default MyStudentProfilePage;
