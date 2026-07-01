import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SchoolIcon from '@mui/icons-material/School';
import { UserMenu } from './UserMenu';
import { SemesterSwitcher } from './SemesterSwitcher';
import { NotificationsBell } from './NotificationsBell';
import { strings } from '@i18n/strings';
import type { CurrentUser } from '@shared/types/api';

export interface TopBarProps {
  user: CurrentUser;
  onMenuToggle: () => void;
  onLogout: () => void;
  schoolName?: string;
  unreadCount: number;
}

/** Fixed top app bar (design-system §3.1, §4.1). header landmark. */
export function TopBar({
  user,
  onMenuToggle,
  onLogout,
  schoolName,
  unreadCount,
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

        <SchoolIcon sx={{ mr: 1 }} aria-hidden />
        <Typography variant="h3" component="span" noWrap sx={{ fontWeight: 700 }}>
          {schoolName ?? strings.app.name}
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Semester switcher hidden on xs (collapses into overflow — design-system §3.3). */}
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <SemesterSwitcher />
          </Box>
          <NotificationsBell count={unreadCount} />
          <UserMenu user={user} onLogout={onLogout} />
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default TopBar;
