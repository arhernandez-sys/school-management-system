import { AppBar, Box, IconButton, Stack, Toolbar, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { UserMenu } from './UserMenu';
import { NotificationsBell } from './NotificationsBell';
import { StudentYearSwitcher } from './StudentYearSwitcher';
import { strings } from '@i18n/strings';
import type { CurrentUser } from '@shared/types/api';
import type { NotificationItem } from './NotificationsBell';

export interface TopBarProps {
  user: CurrentUser;
  onMenuToggle: () => void;
  onLogout: () => void;
  schoolName?: string;
  unreadCount: number;
  /**
   * What the popover lists (D30 §D8). Previously omitted entirely, which is why the popover
   * always read "No new notifications" however high the badge went — real dead UI the plan
   * flagged rather than a missing feature.
   */
  notifications?: NotificationItem[];
  onNotificationSelect?: (id: string) => void;
}

/** Fixed top app bar (design-system §3.1, §4.1). header landmark. */
export function TopBar({
  user,
  onMenuToggle,
  onLogout,
  schoolName,
  unreadCount,
  notifications = [],
  onNotificationSelect,
}: TopBarProps) {
  return (
    <AppBar
      position="fixed"
      elevation={1}
      color="primary"
      component="header"
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
    >
      <Toolbar>
        <IconButton
          edge="start"
          color="inherit"
          aria-label="Toggle navigation menu"
          onClick={onMenuToggle}
          sx={{ mr: 1 }}
        >
          <MenuIcon />
        </IconButton>

        <Box
          component="img"
          src="/logo.jpeg"
          alt={strings.app.schoolName}
          sx={{
            width: 36,
            height: 36,
            mr: 1.5,
            borderRadius: '50%',
            bgcolor: '#FFFFFF',
            p: '2px',
            objectFit: 'contain',
            flexShrink: 0,
          }}
        />
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="h3" component="span" noWrap sx={{ fontWeight: 700, lineHeight: 1.1 }}>
            {schoolName ?? strings.app.name}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{ opacity: 0.85, display: { xs: 'none', sm: 'block' }, lineHeight: 1.2 }}
          >
            {strings.app.schoolName}
          </Typography>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {user.role === 'student' && <StudentYearSwitcher />}
          <NotificationsBell
            count={unreadCount}
            items={notifications}
            onSelect={onNotificationSelect}
          />
          <UserMenu user={user} onLogout={onLogout} />
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default TopBar;
