import { createTheme } from '@mui/material/styles';

/**
 * MUI v6 theme — implements the D19 token set from `ui-design-system.md` §2.
 *
 * Structured via `colorSchemes` so adding a `dark` scheme later (D20) is a config
 * addition, not a refactor. Components must reference `theme.palette.*` tokens,
 * never raw hex (design-system §2.5 mandate).
 *
 * Light mode only for v1 (D20). The dark palette is intentionally NOT wired here;
 * a sketched dark scheme can be added to `colorSchemes.dark` when the toggle ships.
 */

const SYSTEM_FONT_STACK = [
  'Inter', // optional self-hosted enhancement (OQ-C); degrades gracefully below
  'Roboto',
  '"Segoe UI"',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

export const theme = createTheme({
  // MUI v6 token-driven theming. Single light scheme for v1 (D20).
  colorSchemes: {
    light: {
      palette: {
        // Brand palette derived from the BAJC seal: the navy triangle (primary) and
        // the crimson ring/flame (secondary).
        primary: {
          main: '#1E3A6E',
          light: '#4A6BB0',
          dark: '#12264A',
          contrastText: '#FFFFFF',
        },
        secondary: {
          main: '#C21F30',
          light: '#D64A57',
          dark: '#8E1622',
          contrastText: '#FFFFFF',
        },
        error: { main: '#C62828', contrastText: '#FFFFFF' },
        warning: { main: '#B26A00', contrastText: '#FFFFFF' },
        info: { main: '#0277BD', contrastText: '#FFFFFF' },
        success: { main: '#2E7D32', contrastText: '#FFFFFF' },
        text: {
          primary: '#1A2027',
          secondary: '#4A5560',
        },
        divider: '#E0E4E8',
        background: {
          default: '#F4F6F8',
          paper: '#FFFFFF',
        },
      },
    },
  },

  shape: {
    borderRadius: 8,
  },

  spacing: 8, // MUI default 8px grid (design-system §2.3)

  typography: {
    fontFamily: SYSTEM_FONT_STACK,
    h1: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.25 },
    h2: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 },
    h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.35 },
    h4: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
    body1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.43 },
    button: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.75, textTransform: 'none' },
    caption: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.4 },
    overline: { fontSize: '0.75rem', fontWeight: 600, lineHeight: 2.0, textTransform: 'none' },
  },

  components: {
    // Two-tier surface system: Cards are soft-elevated content, Paper stays flat.
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        // A subtle two-layer soft shadow (in addition to the hairline border) lifts
        // content/dashboard cards — StatCard, PeopleListCard, ChartWithTable and the
        // DataTable mobile row cards — a step above the page. Dense data surfaces
        // (DataTable/FilterBar Paper) deliberately stay flat + hairline below, so the
        // elevation split reads as intentional. Radius stays at the theme shape (8).
        root: ({ theme: t }) => ({
          borderRadius: t.shape.borderRadius,
          boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        }),
      },
    },
    MuiPaper: {
      styleOverrides: {
        // Keep elevation-0 paper visually distinct via the divider border.
        outlined: ({ theme: t }) => ({
          borderColor: t.palette.divider,
        }),
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
        size: 'medium',
      },
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
    },
    /**
     * Every dropdown scrolls instead of growing (D43-b).
     *
     * MUI's default menu has NO height cap, so a `<Select>` over a long list renders
     * every option at once: the course picker (114 courses) and the programme,
     * lecturer and student pickers all opened a menu taller than the viewport, which
     * pushes the page around and leaves no obvious way back to the field. Capping the
     * paper turns the same list into a normal scroll.
     *
     * `MenuProps` is set as a DEFAULT PROP rather than a style override so any screen
     * that needs different behaviour can still pass its own `MenuProps` and win.
     *
     * 40vh, not a fixed pixel height: on a 390px phone — the width D33 fixed the
     * PageHeader for — a fixed 320px menu still covers most of the screen, while a
     * viewport fraction stays proportionate on both. The floor keeps it usable on very
     * short windows, where 40vh alone would show barely two options.
     *
     * `autoFocus: false` stops the menu stealing focus from a field the user is still
     * typing in, which matters most on the pickers that sit next to a search box.
     */
    MuiSelect: {
      defaultProps: {
        size: 'small',
        MenuProps: {
          autoFocus: false,
          PaperProps: { sx: { maxHeight: 'max(40vh, 240px)' } },
        },
      },
    },
    /**
     * The same cap for a bare `<Menu>` and for Autocomplete's popup, so a long list
     * behaves identically whichever control is showing it. Without these two, fixing
     * `MuiSelect` alone would leave the type-to-filter pickers (which are Autocompletes)
     * as the only dropdowns that still run off the screen.
     */
    MuiMenu: {
      defaultProps: {
        PaperProps: { sx: { maxHeight: 'max(40vh, 240px)' } },
      },
    },
    MuiAutocomplete: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        listbox: { maxHeight: 'max(40vh, 240px)' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        // py:1 for dense (size="small") rows — design-system §2.4.
        sizeSmall: { paddingTop: 8, paddingBottom: 8 },
        // Uniform header weight app-wide — consolidated from the fontWeight 600/700
        // that individual head cells used to set inline (DataTable, GradebookGrid,
        // ChartWithTable, settings tables, report/transcript documents).
        head: { fontWeight: 600 },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        // Consolidated from the `sx={{ px: 3, pb: 2 }}` every dialog duplicated inline
        // (FormDialog, ConfirmDialog, + the feature dialogs). Top padding keeps the MUI
        // default (8px = spacing(1)) so the rendered spacing is unchanged.
        root: ({ theme: t }) => ({ padding: t.spacing(1, 3, 2, 3) }),
      },
    },
    MuiTooltip: {
      defaultProps: { enterDelay: 300 },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999 }, // pill radius for chips/badges
      },
    },
    // Strengthen (do NOT remove) the focus-visible ring — accessibility §9.2.
    MuiCssBaseline: {
      styleOverrides: {
        ':focus-visible': {
          outline: '2px solid #1E3A6E',
          outlineOffset: '2px',
        },
        // Respect reduced-motion (design-system §9.7).
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
  },
});

export default theme;
