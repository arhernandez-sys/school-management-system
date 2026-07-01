import { useRef } from 'react';
import { Badge, IconButton, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useDisclosure } from '@shared/hooks';

export interface NotificationItem {
  id: string;
  title: string;
  preview?: string;
}

export interface NotificationsBellProps {
  count: number;
  items?: NotificationItem[];
  onSelect?: (id: string) => void;
}

/**
 * Unread-announcement indicator → popover list (design-system §5 #15).
 * v1 scope = in-app announcements only (OQ-E). Foundation renders the bell + popover;
 * Phase 7 (Announcements) wires the unread count + deep links.
 */
export function NotificationsBell({ count, items = [], onSelect }: NotificationsBellProps) {
  const menu = useDisclosure();
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <IconButton
        ref={anchorRef}
        onClick={menu.open}
        aria-label={`Notifications${count > 0 ? `, ${count} unread` : ''}`}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        color="inherit"
      >
        <Badge badgeContent={count} color="error" max={99}>
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorRef.current}
        open={menu.isOpen}
        onClose={menu.close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxWidth: '90vw' } } }}
      >
        {items.length === 0 ? (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              No new notifications
            </Typography>
          </MenuItem>
        ) : (
          items.map((item) => (
            <MenuItem
              key={item.id}
              onClick={() => {
                menu.close();
                onSelect?.(item.id);
              }}
            >
              <ListItemText primary={item.title} secondary={item.preview} />
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
}

export default NotificationsBell;
