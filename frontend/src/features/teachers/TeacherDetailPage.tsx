import { useParams } from 'react-router-dom';
import { TeacherProfileView } from './components/TeacherProfileView';

/**
 * Teacher detail at `${ROUTES.teachers}/:teacherId` — the principal/secretary mount
 * point. It reaches here through the teachers-module role gate (students/teachers have
 * no teachers-directory access), so the profile always renders in `manage` mode with the
 * full action set. The shared {@link TeacherProfileView} powers this alongside the
 * teacher self-view (`/me`) and the student read-only view (`/teacher/:id`).
 *
 * ⚠️ Route gating is UX only — the server re-checks role + ownership on every
 * /teachers/{id} call (NFR-SEC-01).
 */
export function TeacherDetailPage() {
  const { teacherId } = useParams<{ teacherId: string }>();
  return <TeacherProfileView teacherId={teacherId} mode="manage" />;
}

export default TeacherDetailPage;
