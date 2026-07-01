import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Tooltip,
} from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import { navSectionsForRole } from './navConfig';
import type { Role } from '@shared/types/enums';

export const DRAWER_WIDTH = 240;
export const DRAWER_WIDTH_MINI = 72;

export interface SidebarProps {
  role: Role;
  /** Mobile temporary-drawer open state. */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** Desktop mini-rail collapse state. */
  collapsed: boolean;
}

/**
 * Role-aware navigation drawer (design-system §3, §4.1). nav landmark.
 * - Permanent on >=md, temporary overlay on <md (responsive §3.3).
 * - Active item highlighted via NavLink aria-current.
 * - Mini-rail collapse shows icon-only items with tooltips.
 */
export function Sidebar({ role, mobileOpen, onMobileClose, collapsed }: SidebarProps) {
  const location = useLocation();
  const sections = navSectionsForRole(role);
  const width = collapsed ? DRAWER_WIDTH_MINI : DRAWER_WIDTH;

  const navContent = (
    <Box component="nav" aria-label="Main navigation" sx={{ overflowX: 'hidden' }}>
      <Toolbar />
      {sections.map((section) => (
        <List
          key={section.heading}
          dense
          subheader={
            !collapsed ? (
              <ListSubheader
                component="div"
                disableSticky
                sx={{ bgcolor: 'transparent', textTransform: 'none', fontWeight: 600 }}
              >
                {section.heading}
              </ListSubheader>
            ) : undefined
          }
        >
          {section.items.map((item) => {
            const selected =
              location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
            const button = (
              <ListItemButton
                key={item.path}
                component={NavLink}
                to={item.path}
                selected={selected}
                onClick={onMobileClose}
                aria-current={selected ? 'page' : undefined}
                sx={{
                  minHeight: 44, // >=44px touch target (a11y §9.7)
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  px: collapsed ? 1 : 2,
                  '&.Mui-selected': {
                    borderLeft: 3,
                    borderColor: 'primary.main',
                  },
                }}
              >
                <ListItemIcon
                  sx={{ minWidth: 0, mr: collapsed ? 0 : 2, justifyContent: 'center' }}
                >
                  {item.icon}
                </ListItemIcon>
                {!collapsed && <ListItemText primary={item.label} />}
              </ListItemButton>
            );

            return collapsed ? (
              <Tooltip key={item.path} title={item.label} placement="right">
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </List>
      ))}
    </Box>
  );

  return (
    <Box component="div" sx={{ width: { md: width }, flexShrink: { md: 0 } }}>
      {/* Temporary drawer — mobile (<md) */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        {navContent}
      </Drawer>

      {/* Permanent drawer — desktop (>=md), mini-collapsible */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            width,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            transition: (theme) =>
              theme.transitions.create('width', {
                duration: theme.transitions.duration.shorter,
              }),
          },
        }}
        open
      >
        {navContent}
      </Drawer>
    </Box>
  );
}

export default Sidebar;
