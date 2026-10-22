import { Navigate, Route, Routes } from 'react-router-dom';
import { CoursesPage } from '@features/settings/CoursesPage';
import { ProgramsScreen } from '@features/programs/ProgramsScreen';
import { ProgramCurriculumScreen } from '@features/programs/ProgramCurriculumScreen';

/**
 * The CATALOG — courses and programmes, at the top level (D44).
 *
 * WHY THIS EXISTS. Both screens lived under Settings (`/settings/courses`,
 * `/settings/programs`), which is where the catalog ended up because nothing else claimed
 * it. The client asked for them in the main menu, where the work is: a Dean builds an
 * 87-credit programme sequence far more often than they edit the school's address.
 *
 * The SCREENS did not move — they are imported from where they already are. Only the
 * routing did, so this is a re-mount rather than a rewrite, and `features/settings` keeps
 * serving the old paths as redirects.
 *
 * Both screens already hide their own write controls behind `canWrite(role, 'courses' |
 * 'programs')`, so a read-only caller (Registrar, Auditor, HOD) gets the lists and the
 * curriculum view with no Add / Edit / Retire. The route-level gate is `courses` — see the
 * note in `navConfig` about `programs` being `view-all` for every role.
 */
export function CatalogPage({ section }: { section: 'courses' | 'programs' }) {
  if (section === 'courses') {
    return (
      <Routes>
        <Route index element={<CoursesPage />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route index element={<ProgramsScreen />} />
      {/* The curriculum builder is a nested route rather than a dialog: a programme's plan
          is a page-sized thing, and a Dean part-way through entering a sequence needs a
          URL they can come back to. */}
      <Route path=":programId" element={<ProgramCurriculumScreen />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

export function CoursesRoute() {
  return <CatalogPage section="courses" />;
}

export function ProgramsRoute() {
  return <CatalogPage section="programs" />;
}

export default CatalogPage;
