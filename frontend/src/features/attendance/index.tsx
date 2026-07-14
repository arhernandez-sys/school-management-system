import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { AttendanceRegisterScreen } from './screens/AttendanceRegisterScreen';
import { AttendanceSummaryScreen } from './screens/AttendanceSummaryScreen';
import { MyAttendanceScreen } from './screens/MyAttendanceScreen';

/**
 * Attendance module (Phase 7, D-Q4) — a tabbed, nested-routed container mounted at
 * `/attendance/*` (mirrors features/settings/index.tsx). Attendance is per-section,
 * per-day: for a (section, date) each enrolled student is present/absent/late/excused.
 *
 * Sub-navigation is role-aware (UX only; the server is authoritative on every call):
 *  - Teacher: Record (tablet-first daily register, own classes) + Summary.
 *  - Principal / Secretary: Summary only — they view-all, they do not record (§7.6).
 *  - Student: My attendance (own read-only summary + history).
 *
 * The register/summary screens persist their section + date selection to the URL
 * (?section_id=&date=), so a tab is shareable and survives reload.
 */
interface AttendanceTab {
  label: string;
  path: string;
}

export function AttendancePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = user?.role;
  const isStudent = role === 'student';
  const isTeacher = role === 'teacher';

  const tabs = useMemo<AttendanceTab[]>(() => {
    if (isStudent) return [{ label: 'My attendance', path: 'me' }];
    if (isTeacher) {
      return [
        { label: 'Record', path: 'record' },
        { label: 'Summary', path: 'summary' },
      ];
    }
    // Principal / Secretary — view-all.
    return [{ label: 'Summary', path: 'summary' }];
  }, [isStudent, isTeacher]);

  const defaultPath = isStudent ? 'me' : isTeacher ? 'record' : 'summary';

  // Preserve the current query string (section_id/date) when switching tabs.
  const activeSegment =
    location.pathname.replace(`${ROUTES.attendance}/`, '').split('/')[0] || defaultPath;
  const activeTab = tabs.some((t) => t.path === activeSegment) ? activeSegment : false;

  const goToTab = (value: string) => navigate(`${ROUTES.attendance}/${value}${location.search}`);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {tabs.length > 1 && (
        <Tabs
          value={activeTab}
          onChange={(_, value: string) => goToTab(value)}
          aria-label="Attendance sections"
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((t) => (
            <Tab key={t.path} value={t.path} label={t.label} />
          ))}
        </Tabs>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route index element={<Navigate to={defaultPath} replace />} />
          {isStudent && <Route path="me" element={<MyAttendanceScreen />} />}
          {isTeacher && <Route path="record" element={<AttendanceRegisterScreen />} />}
          {!isStudent && <Route path="summary" element={<AttendanceSummaryScreen />} />}
          {/* Unknown sub-path → the role's landing tab. */}
          <Route path="*" element={<Navigate to={defaultPath} replace />} />
        </Routes>
      </Box>
    </Box>
  );
}

export default AttendancePage;
