import { useState } from 'react';
import {
  Box,
  Collapse,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Tooltip,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { NavLink, useLocation } from 'react-router-dom';
import { navSectionsForRole, type NavItem } from './navConfig';
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
  /**
   * D32 (brief §4) — the Dean's student grade-visibility switch, from `CurrentUser`.
   * Drops "My Grades" for a student when grades are unpublished. Defaults to shown, so
   * a stale session payload never hides a working screen.
   */
  studentsCanViewGrades?: boolean;
}

/**
 * Role-aware navigation drawer (design-system §3, §4.1). nav landmark.
 * - Permanent on >=md, temporary overlay on <md (responsive §3.3).
 * - Active item highlighted via NavLink aria-current.
 * - Mini-rail collapse shows icon-only items with tooltips.
 */
export function Sidebar({
  role,
  mobileOpen,
  onMobileClose,
  collapsed,
  studentsCanViewGrades = true,
}: SidebarProps) {
  const location = useLocation();
  const sections = navSectionsForRole(role, { studentsCanViewGrades });
  /**
   * D44 — which groups the user has opened, keyed by the parent's path.
   *
   * Deliberately NOT persisted, and deliberately allowed to be empty: a group whose child
   * route is active defaults to OPEN (see `renderItem`), so arriving at Course Offerings
   * from a link shows you where you are without anyone having expanded anything. The state
   * only records a deviation from that.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const width = collapsed ? DRAWER_WIDTH_MINI : DRAWER_WIDTH;

  /** Exact match, or a child route beneath it. The rule the sidebar has always used. */
  const matches = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  /**
   * D44 — one item, and its children if it has any.
   *
   * ⚠️ A PARENT IS SELECTED WHEN A CHILD IS. `/offerings` is not a sub-path of `/courses`,
   * so the prefix rule alone would leave the Courses group unlit while Course Offerings is
   * open — the nav would say you are nowhere. `matchesDeep` is what makes the group behave
   * as one destination, and it is what "it shows only courses highlighted" asks for.
   *
   * The child itself is NOT given the selected border: two lit rows for one location reads
   * as two places. It gets weight instead.
   */
  const renderItem = (item: NavItem, depth = 0) => {
    const childActive = (item.children ?? []).some((c) => matches(c.path));
    const selected = matches(item.path) || childActive;
    const hasChildren = Boolean(item.children?.length) && !collapsed;
    const open = expanded[item.path] ?? childActive;

    const button = (
      <ListItemButton
        key={item.path}
        component={NavLink}
        to={item.path}
        selected={depth === 0 ? selected : matches(item.path)}
        onClick={onMobileClose}
        aria-current={matches(item.path) ? 'page' : undefined}
        sx={{
          minHeight: 44, // >=44px touch target (a11y §9.7)
          justifyContent: collapsed ? 'center' : 'flex-start',
          px: collapsed ? 1 : 2,
          pl: !collapsed && depth > 0 ? 5 : undefined,
          '&.Mui-selected': {
            // Only the top level carries the rail marker; see the note above.
            borderLeft: depth === 0 ? 3 : 0,
            borderColor: 'primary.main',
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 0, mr: collapsed ? 0 : 2, justifyContent: 'center' }}>
          {item.icon}
        </ListItemIcon>
        {!collapsed && (
          <ListItemText
            primary={item.label}
            slotProps={{
              primary: {
                variant: depth > 0 ? 'body2' : 'body1',
                fontWeight: matches(item.path) ? 600 : undefined,
              },
            }}
          />
        )}
      </ListItemButton>
    );

    if (collapsed) {
      // The mini rail has no room for a tree; the parent alone stands for the group.
      return (
        <Tooltip key={item.path} title={item.label} placement="right">
          {button}
        </Tooltip>
      );
    }

    if (!hasChildren) return button;

    return (
      <Box key={item.path}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>{button}</Box>
          {/* A separate control, so clicking the LABEL still navigates. Folding the two
              together would turn a real destination into a toggle. */}
          <IconButton
            size="small"
            onClick={() => setExpanded((prev) => ({ ...prev, [item.path]: !open }))}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
            aria-expanded={open}
            aria-controls={`nav-group-${item.path}`}
            sx={{ mr: 1 }}
          >
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <List component="div" disablePadding id={`nav-group-${item.path}`}>
            {item.children!.map((child) => renderItem(child, depth + 1))}
          </List>
        </Collapse>
      </Box>
    );
  };


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
          {section.items.map((item) => renderItem(item))}
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
