import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canAccessModule, canWrite } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';
import { CoursesPage } from './CoursesPage';
import { ProgramsScreen } from '@features/programs/ProgramsScreen';
import { ProgramCurriculumScreen } from '@features/programs/ProgramCurriculumScreen';
import { SchoolProfileScreen } from './screens/SchoolProfileScreen';
import { AcademicStructureScreen } from './screens/AcademicStructureScreen';
import { GradingScaleScreen } from './screens/GradingScaleScreen';
import { AssessmentPolicyScreen } from './screens/AssessmentPolicyScreen';
import { UsersScreen } from './screens/UsersScreen';
import { AccountScreen } from './screens/AccountScreen';
import { AuditLogScreen } from './screens/AuditLogScreen';

/**
 * Settings module (Phase 7.2) — a tabbed, nested-routed container mounted at
 * `/settings/*`. Sub-navigation is role-aware:
 *  - Dean / Registrar: school, academic structure, courses, programmes, grading scale,
 *    assessment policy, users, account. (Within each screen, Dean-only writes are
 *    further gated; the server is authoritative — the Registrar sees Courses and
 *    Programmes read-only, per D30 §D14.)
 *  - Teacher / Student: account only (their sole Settings capability, permissions map).
 *
 * Nav visibility is UX-only; every route is still role-guarded upstream and the server
 * enforces on each call. Each screen owns its data via the generated Settings hooks.
 */
interface SettingsTab {
  label: string;
  /** Path segment under /settings. */
  path: string;
}

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const canManage = user ? canWrite(user.role, 'settings') : false;

  /**
   * D43 — the tabs are gated INDIVIDUALLY now, not all-or-nothing on write access.
   *
   * They used to be: `canWrite(role, 'settings')` gave you all eight, and anything else
   * gave you "My account" alone. That was fine while the only read-only roles had no
   * business in Settings at all — but an Auditor is supposed to see the catalog and the
   * audit trail, and an HOD the catalog, and neither can write a thing.
   *
   * `canReadCatalog` keys on the **`courses`** module rather than `programs`, which
   * looks arbitrary and is not: `programs` is `'view-all'` for EVERY role (a student may
   * read their own prospectus) and nothing has ever surfaced it, so using it here would
   * put a Programmes tab in front of Lecturers and Students for the first time as a side
   * effect of this change. `courses` is `'none'` for exactly those two roles, which is
   * the line we actually want.
   */
  const canReadCatalog = user ? canAccessModule(user.role, 'courses') : false;
  const canReadAudit = user ? canAccessModule(user.role, 'audit') : false;

  const tabs = useMemo<SettingsTab[]>(() => {
    const list: SettingsTab[] = [];
    if (canManage) {
      list.push(
        { label: 'School', path: 'school' },
        { label: 'Academic structure', path: 'academic' },
      );
    }
    if (canReadCatalog) {
      list.push({ label: 'Courses', path: 'courses' });
      // D30 §D3 — the studies and the course sequence each one requires. Sits
      // next to Courses because a programme is built OUT of catalog courses.
      list.push({ label: 'Programmes', path: 'programs' });
    }
    if (canManage) {
      list.push(
        { label: 'Grading scale', path: 'grading' },
        { label: 'Assessment policy', path: 'policy' },
        { label: 'Users', path: 'users' },
      );
    }
    if (canReadAudit) list.push({ label: 'Audit log', path: 'audit' });
    list.push({ label: 'My account', path: 'account' });
    return list;
  }, [canManage, canReadCatalog, canReadAudit]);

  //: Land on the first tab the caller actually has, never on one they cannot open.
  const defaultPath = tabs[0]?.path ?? 'account';

  // Derive the active tab from the URL (…/settings/<segment>).
  const activeSegment = location.pathname.replace(`${ROUTES.settings}/`, '').split('/')[0] || defaultPath;
  const activeTab = tabs.some((t) => t.path === activeSegment) ? activeSegment : false;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={activeTab}
        onChange={(_, value: string) => navigate(`${ROUTES.settings}/${value}`)}
        aria-label="Settings sections"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map((t) => (
          <Tab key={t.path} value={t.path} label={t.label} />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route index element={<Navigate to={defaultPath} replace />} />
          <Route path="account" element={<AccountScreen />} />
          {canReadCatalog && (
            <>
              {/* Both screens already hide their own write controls behind
                  `canWrite(role, 'courses' | 'programs')`, so a read-only caller gets
                  the list and the prerequisites view with no Add/Edit/Retire. */}
              <Route path="courses" element={<CoursesPage />} />
              <Route path="programs" element={<ProgramsScreen />} />
              {/* The curriculum builder is a nested route rather than a dialog: a
                  programme's plan is a page-sized thing, and a Dean part-way through
                  entering an 87-credit sequence needs a URL they can come back to. */}
              <Route path="programs/:programId" element={<ProgramCurriculumScreen />} />
            </>
          )}
          {canReadAudit && <Route path="audit" element={<AuditLogScreen />} />}
          {canManage && (
            <>
              <Route path="school" element={<SchoolProfileScreen />} />
              <Route path="academic" element={<AcademicStructureScreen />} />
              <Route path="grading" element={<GradingScaleScreen />} />
              <Route path="policy" element={<AssessmentPolicyScreen />} />
              <Route path="users" element={<UsersScreen />} />
            </>
          )}
          {/* Unknown sub-path → back to the section landing. */}
          <Route path="*" element={<Navigate to={defaultPath} replace />} />
        </Routes>
      </Box>
    </Box>
  );
}

export default SettingsPage;
