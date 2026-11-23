import { useRef } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { useNavigate } from 'react-router-dom';
import { useDisclosure } from '@shared/hooks';
import { ROUTES } from '@shared/constants/routes';
import { strings } from '@i18n/strings';
import { ROLE_LABEL } from '@shared/auth/roleLabels';
import type { CurrentUser } from '@shared/types/api';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export interface UserMenuProps {
  user: CurrentUser;
  onLogout: () => void;
}

/** Avatar → identity + account + logout (design-system §5 #16). Keyboard-operable. */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  const menu = useDisclosure();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  return (
    <>
      <IconButton
        ref={anchorRef}
        onClick={menu.open}
        size="small"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        sx={{ ml: 1 }}
      >
        <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: '0.875rem' }}>
          {initials(user.full_name)}
        </Avatar>
      </IconButton>

      <Menu
        anchorEl={anchorRef.current}
        open={menu.isOpen}
        onClose={menu.close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1, maxWidth: 260 }}>
          <Typography variant="subtitle1" noWrap>
            {user.full_name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {user.email}
          </Typography>
          <Chip label={ROLE_LABEL[user.role]} size="small" color="primary" sx={{ mt: 0.5 }} />
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            menu.close();
            navigate(ROUTES.settings);
          }}
        >
          <ListItemIcon>
            <AccountCircleIcon fontSize="small" />
          </ListItemIcon>
          {strings.auth.myAccount}
        </MenuItem>
        <MenuItem
          onClick={() => {
            menu.close();
            onLogout();
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          {strings.auth.logout}
        </MenuItem>
      </Menu>
    </>
  );
}

export default UserMenu;
