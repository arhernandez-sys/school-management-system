import { useRef } from 'react';
import {
  Badge,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
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
 * Clamp a Typography to `lines` lines, ellipsising the overflow.
 *
 * `-webkit-line-clamp` is the only thing that ellipsises a MULTI-line box, and it is
 * supported in every browser this app targets (it is unprefixed nowhere, so the vendor
 * spelling is the correct one, not a fallback). `overflowWrap: anywhere` is what stops a
 * single long unbroken token — a URL, a run-on course code — from widening the popover
 * instead of wrapping inside it.
 */
const clamp = (lines: number) =>
  ({
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    // MenuItem sets `white-space: nowrap` on its own children; the clamp needs wrapping.
    whiteSpace: 'normal',
  }) as const;

/**
 * Unread-announcement indicator → popover list (design-system §5 #15).
 * v1 scope = in-app announcements only (OQ-E). Foundation renders the bell + popover;
 * Phase 7 (Announcements) wires the unread count + deep links.
 *
 * **D33 — the wording used to be CLIPPED, not ellipsised.** `MenuItem` applies
 * `white-space: nowrap`, so a long announcement title or a revision preview
 * ("Foundations of Programming (ITEC-101 · Sec A) · 62 → 71 · asked by …") ran off the
 * 320px popover with no visual sign that anything had been cut — the reader could not tell
 * a truncated line from a complete one. Now:
 *
 * * the **title** is one line ending in `…`;
 * * the **preview** is clamped to two lines ending in `…`;
 * * the **full text of both** is on the item's tooltip and its `title` attribute, so
 *   nothing is only-truncated — hover on a pointer, long-press on touch, and it is read
 *   out in full by a screen reader regardless.
 *
 * The popover is a prompt, not an inbox (`MAX_PER_SOURCE` in `useNotifications`), so
 * clamping is the right answer rather than growing the box: the item exists to be clicked
 * through to the thing itself.
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
        slotProps={{
          paper: {
            sx: {
              // Roomier than the old fixed 320 so fewer titles need clamping at all, but
              // still bounded by the viewport on a phone (the bell sits in a right-anchored
              // toolbar, so an unbounded popover would overflow the screen edge).
              width: { xs: 'calc(100vw - 32px)', sm: 380 },
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: { xs: '70vh', sm: 480 },
            },
          },
        }}
      >
        {items.length === 0 ? (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              No new notifications
            </Typography>
          </MenuItem>
        ) : (
          items.map((item) => {
            const full = item.preview ? `${item.title} — ${item.preview}` : item.title;
            return (
              <MenuItem
                key={item.id}
                onClick={() => {
                  menu.close();
                  onSelect?.(item.id);
                }}
                // The native tooltip, for touch and for anyone who never hovers.
                title={full}
                sx={{ alignItems: 'flex-start', py: 1, whiteSpace: 'normal' }}
              >
                {/* The Tooltip wraps the TEXT, not the MenuItem. `Menu` clones its direct
                    children to inject keyboard-navigation props, so an extra element
                    between the two would have to forward them faithfully — not worth
                    depending on for a hover hint. */}
                <Tooltip title={full} placement="left" enterDelay={400}>
                  <ListItemText
                    primary={item.title}
                    secondary={item.preview}
                    slotProps={{
                      primary: { variant: 'body2', fontWeight: 500, sx: clamp(1) },
                      secondary: { variant: 'caption', sx: clamp(2) },
                    }}
                  />
                </Tooltip>
              </MenuItem>
            );
          })
        )}
      </Menu>
    </>
  );
}

export default NotificationsBell;
