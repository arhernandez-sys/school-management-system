import { useState } from 'react';
import { Box, Link as MuiLink, Toolbar } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useUnreadCount } from '@features/announcements/hooks/useAnnouncements';
import { useDisclosure, useScrollToTop } from '@shared/hooks';
import { LoadingState, PageContainer } from '@shared/components';
import { strings } from '@i18n/strings';

/**
 * Authenticated layout shell (design-system §4.1). Composes TopBar + role-aware
 * Sidebar + scrolling MainRegion with the routed <Outlet/>.
 *
 * - Skip link is the first focusable element (WCAG 2.4.1).
 * - Single scroll owner: MainRegion scrolls; app bar + drawer are fixed.
 *
 * Students get a global academic-year switcher in the TopBar (YearContext) that
 * re-scopes their view; staff scope per-module. The unread announcements count comes
 * from the Announcements module (falls back to 0 when unavailable).
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const mobileDrawer = useDisclosure();
  const [collapsed, setCollapsed] = useState(false);

  // Unread announcements count for the TopBar bell. Falls back to 0 while loading or
  // if the endpoint is unavailable (e.g. real-backend mode before the module ships).
  const { data: unreadCount = 0 } = useUnreadCount();

  // Reset scroll to top on every route change (covers nested descendant routes).
  useScrollToTop();

  if (!user) {
    // Should not happen inside ProtectedRoute, but guards the type.
    return <LoadingState variant="page" label={strings.common.loading} />;
  }

  const handleMenuToggle = () => {
    // On mobile, toggle the temporary drawer; on desktop, toggle the mini-rail.
    if (window.matchMedia('(min-width:900px)').matches) {
      setCollapsed((c) => !c);
    } else {
      mobileDrawer.toggle();
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <MuiLink
        href="#main-content"
        sx={{
          position: 'absolute',
          left: -9999,
          top: 0,
          zIndex: (theme) => theme.zIndex.tooltip + 1,
          p: 1,
          bgcolor: 'background.paper',
          '&:focus': { left: 8, top: 8 },
        }}
      >
        {strings.app.skipToContent}
      </MuiLink>

      <TopBar
        user={user}
        onMenuToggle={handleMenuToggle}
        onLogout={() => void logout()}
        unreadCount={unreadCount}
      />

      <Sidebar
        role={user.role}
        mobileOpen={mobileDrawer.isOpen}
        onMobileClose={mobileDrawer.close}
        collapsed={collapsed}
      />

      <Box
        component="main"
        id="main-content"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 2, md: 3 },
          pb: { xs: 2, md: 3 },
          bgcolor: 'background.default',
        }}
      >
        <Toolbar /> {/* spacer under the fixed app bar */}
        <PageContainer>
          <Outlet />
        </PageContainer>
      </Box>
    </Box>
  );
}

export default AppShell;
