import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canAccessModule, canWrite } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';
import { ClassroomsScreen } from '@features/classrooms/ClassroomsScreen';
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

/**
 * D44 — `/settings/programs/:programId` → `/programs/:programId`, keeping the id.
 *
 * A plain `<Navigate>` cannot: the target depends on a route param, and dropping it would
 * send someone who bookmarked one programme's curriculum to the list of all of them.
 */
function RedirectToProgramCurriculum() {
  const { programId } = useParams();
  return <Navigate to={`${ROUTES.programs}/${programId}`} replace />;
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
   * D44 moved the catalog out of here entirely, so the `canReadCatalog` gate went with
   * it — but the REASONING behind it did not, and now lives in `navConfig`: the catalog is
   * keyed on the **`courses`** module rather than `programs`, because `programs` is
   * `'view-all'` for EVERY role and keying on it would put Programmes in front of
   * Lecturers and Students. Same trap, new location.
   */
  const canReadAudit = user ? canAccessModule(user.role, 'audit') : false;

  const tabs = useMemo<SettingsTab[]>(() => {
    const list: SettingsTab[] = [];
    if (canManage) {
      list.push(
        { label: 'School', path: 'school' },
        { label: 'Academic structure', path: 'academic' },
      );
    }
    // D44 — Courses and Programmes left this tab strip for the main menu. The ROUTES
    // below survive as redirects, so old bookmarks and links still land somewhere.
    if (canManage) {
      list.push(
        // D44 — the rooms courses are scheduled into. Estate administration, so it sits
        // with School and Academic structure rather than in the main menu.
        { label: 'Classrooms', path: 'classrooms' },
        { label: 'Grading scale', path: 'grading' },
        { label: 'Assessment policy', path: 'policy' },
        { label: 'Users', path: 'users' },
      );
    }
    if (canReadAudit) list.push({ label: 'Audit log', path: 'audit' });
    list.push({ label: 'My account', path: 'account' });
    return list;
  }, [canManage, canReadAudit]);

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
          {/* D44 — the catalog moved to `/courses` and `/programs`. These three redirects
              are kept because a route path is user-visible: bookmarks, shared links and
              the address bar all carry the old ones, and a 404 is a poor reward for
              having saved a link. `replace` so Back does not bounce off the redirect. */}
          <Route path="courses" element={<Navigate to={ROUTES.courses} replace />} />
          <Route path="programs" element={<Navigate to={ROUTES.programs} replace />} />
          <Route
            path="programs/:programId"
            element={<RedirectToProgramCurriculum />}
          />
          {canManage && <Route path="classrooms" element={<ClassroomsScreen />} />}
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
