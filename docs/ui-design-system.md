# UI Design System — School Management System (SIS)

> **Phase 3 — UI/UX Design.** Owner: `ui-ux-designer`. This document is the design specification the Phase 6–7 frontend engineers implement against. It honors every locked decision in `complete-work.md` (D1–D17), the requirements in `requirements.md` (4 roles, 11 modules, permission matrix, 75 FRs), and the architecture in `architecture.md` (feature-based structure D15, role-aware AppShell, shared components, composite `/dashboard` endpoint, TanStack Query state strategy).
>
> It does **not** define the DB schema (Phase 4), the API contract (Phase 5), or write application code (Phase 6–7). It defines *what the UI is and how it behaves* so an engineer can build it without re-deciding design questions.
>
> **Constraints honored:** Component library = **Material UI (MUI v6)**, designed within MUI's theming/`sx`/component system — no bespoke design language that fights MUI. Charts = **Recharts**, always paired with an accessible table (`ChartWithTable`). Role-aware nav/actions (hidden controls are a UX aid only; the server enforces — NFR-SEC-01). 2 semesters/year (D10). 0–100 numeric grading with derived letter grades (D11). Accessibility target = **WCAG 2.1 AA** (NFR-A11Y-01/02).

_Last updated: 2026-06-26 — Phase 3, revised in Phase 4.5 to reconcile **D23** (Class = multi-subject SECTION/homeroom: per-(section,subject) gradebooks, explicit Subjects tab, per-section attendance) and **D24** (multi-year Transcript screen, §7.10). See §6 (sitemap +1), §5 (component inventory 22→23: new `CollapsibleSection`), §7.5/§7.7/§7.8/§7.10._

---

## Table of Contents

1. [Design Principles & Visual Direction](#1-design-principles--visual-direction)
2. [MUI Theme Specification](#2-mui-theme-specification)
3. [Navigation Structure](#3-navigation-structure)
4. [Application Shell / Layout System](#4-application-shell--layout-system)
5. [Component Inventory](#5-component-inventory)
6. [Page Hierarchy / Sitemap](#6-page-hierarchy--sitemap)
7. [Key Page Layout Specifications](#7-key-page-layout-specifications)
8. [Data Display Patterns](#8-data-display-patterns)
9. [Accessibility Specification](#9-accessibility-specification)
10. [Interaction & Feedback Patterns](#10-interaction--feedback-patterns)
11. [New Decisions & Open Questions for the Orchestrator](#11-new-decisions--open-questions-for-the-orchestrator)

---

## 1. Design Principles & Visual Direction

### 1.1 Product character

This is an **operational tool used daily by staff under time pressure** (a teacher recording attendance between classes, a secretary enrolling students at a counter) and **periodically by students** checking grades. It is not a marketing site. The visual direction is therefore **calm, dense-but-legible, trustworthy, and fast to scan** — the aesthetic of a well-run records office, not a consumer app.

### 1.2 The five guiding principles, applied here

| Principle | What it means concretely in this SIS |
|---|---|
| **1. Clarity** | The active role, the active semester, and the current location (breadcrumbs) are always visible. Every screen states what it is (PageHeader title) and the primary action is unambiguous. Numeric grades always show their derived letter beside them; attendance statuses use a label + color + icon, never color alone. |
| **2. Simplicity** | Progressive disclosure: dashboards summarize and link out; detail pages use tabs to avoid one endless scroll. Forms ask only for what a task needs. A teacher's screen never shows admin chrome. |
| **3. Consistency** | One DataTable, one form pattern, one ConfirmDialog, one PageHeader everywhere. The same verb ("Enroll", "Record", "Release") means the same thing across modules. MUI defaults are honored rather than re-skinned. |
| **4. Accessibility** | WCAG 2.1 AA is a hard requirement, not a polish pass. Keyboard-first, visible focus, ≥4.5:1 text contrast, labels on every field, ≥44×44px touch targets, charts mirrored by tables. Built in from the first component. |
| **5. Business goals** | The goals are *task completion* and *accurate records*. The design optimizes the high-frequency flows (attendance, grade entry, enrollment) to the fewest correct steps (NFR-USE-01) and prevents the costly errors (deleting a graded student, double attendance) with confirmation and server-enforced guards. No dark patterns. |

### 1.3 Density stance

**Comfortable-compact.** Default MUI spacing (8px unit) for layout, but data tables use MUI's `size="small"` rows and dense list density so a roster of 35 students or a gradebook of 12 assessments fits on one screen without endless scrolling. Forms and reading surfaces stay comfortable. This is a deliberate split: *dense where staff scan data, comfortable where users read or input*.

### 1.4 Tone of copy

Plain, direct, school-appropriate English (externalized via `i18n/`, NFR-LOC-01). Buttons are verbs ("Record attendance", "Release grades"). Empty states are encouraging and actionable ("No assessments yet — create your first one"). Errors are human ("Score can't be higher than the maximum of 100"), never codes.

---

## 2. MUI Theme Specification

> Concrete tokens, directly translatable to a `createTheme()` config in `theme/theme.ts` (per architecture §5). Values are decisive — engineers should not re-pick them.

### 2.1 Color palette

A **professional blue primary** (trust, calm, institutional) with a **teal secondary** for accent/secondary actions, and a strict semantic set for status. All foreground/background pairings below meet **≥4.5:1** for body text and **≥3:1** for large text and UI boundaries.

| Token | Hex | On-color (text) | Usage |
|---|---|---|---|
| `primary.main` | `#1F5BA8` | `#FFFFFF` | App bar, primary buttons, active nav, links, focus accents |
| `primary.light` | `#5A87D4` | `#0A1929` | Hover tints, selected-row background base |
| `primary.dark` | `#143E78` | `#FFFFFF` | Pressed states, app bar in dark mode |
| `secondary.main` | `#0E7C7B` | `#FFFFFF` | Secondary/complementary actions, chips, chart accent 2 |
| `secondary.dark` | `#0A5958` | `#FFFFFF` | Pressed secondary |
| `error.main` | `#C62828` | `#FFFFFF` | Destructive actions, validation errors, "Absent", "F" / failing grade |
| `warning.main` | `#B26A00` | `#FFFFFF` | Over-capacity warnings, "Late", "pending" states, unsaved-changes (darkened from MUI default `#ED6C02` to clear 4.5:1 on white for text use) |
| `info.main` | `#0277BD` | `#FFFFFF` | Informational banners, "Excused", neutral notices |
| `success.main` | `#2E7D32` | `#FFFFFF` | Success toasts, "Present", "Active" status, "Released" / passing grade |
| `text.primary` | `#1A2027` | — | Primary text (~15.8:1 on white) |
| `text.secondary` | `#4A5560` | — | Secondary/helper text (~7.4:1 on white) |
| `divider` | `#E0E4E8` | — | Table borders, dividers, card outlines |
| `background.default` | `#F4F6F8` | — | App canvas (subtle gray so white cards lift) |
| `background.paper` | `#FFFFFF` | — | Cards, tables, dialogs, drawer |

**Semantic usage rules (enforced, not decorative):**
- **Color is never the sole carrier of meaning** (NFR-A11Y, WCAG 1.4.1). Every status uses **color + text label + icon** (e.g., Present = green dot + "Present" + check icon).
- Grade letters map to color but always display the letter and number: A→`success`, B→`primary`, C→`info`, D→`warning`, F→`error`.
- Destructive actions are the *only* use of `error` on buttons.

### 2.2 Typography

System font stack (zero web-font latency, NFR-PERF; broad glyph coverage for locale support). Define on `typography.fontFamily`:

```
"Inter", "Roboto", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif
```

> Inter is listed first as an optional self-hosted enhancement; the stack degrades gracefully to Roboto/Segoe UI with no layout shift. If self-hosting Inter adds ops cost, drop it — Roboto (MUI default) is fully acceptable. **Self-hosted Inter is optional, not required (see OQ-C).**

| Variant | Size | Weight | Line height | Usage |
|---|---|---|---|---|
| `h1` | 2.0rem (32px) | 700 | 1.25 | Reserved (rare; report card title, login brand) |
| `h2` | 1.5rem (24px) | 700 | 1.3 | PageHeader page title |
| `h3` | 1.25rem (20px) | 600 | 1.35 | Section headings, dialog titles, card titles |
| `h4` | 1.125rem (18px) | 600 | 1.4 | Sub-section headings |
| `subtitle1` | 1rem (16px) | 600 | 1.5 | StatCard labels, emphasized list primaries |
| `body1` | 1rem (16px) | 400 | 1.5 | Default body, form inputs, table cells |
| `body2` | 0.875rem (14px) | 400 | 1.43 | Dense table cells, secondary text, helper text |
| `button` | 0.875rem (14px) | 600 | 1.75 | Buttons (`textTransform: 'none'` — sentence case, not UPPERCASE) |
| `caption` | 0.75rem (12px) | 400 | 1.4 | Timestamps, metadata, chart axis labels |
| `overline` | 0.75rem (12px) | 600 | 2.0 | Group labels in nav, table section dividers |

Global override: **`textTransform: 'none'`** on buttons and tabs (uppercase hurts scannability and localization). Minimum on-screen text size is **12px** and only for non-essential metadata; never use 12px for primary content.

### 2.3 Spacing, shape, elevation

| Token | Value | Notes |
|---|---|---|
| `spacing` unit | **8px** (MUI default) | Use the `theme.spacing()` scale everywhere: 0.5, 1, 2, 3, 4 → 4/8/16/24/32px. No magic numbers. |
| `shape.borderRadius` | **8px** | Cards, buttons, inputs, dialogs. Chips/badges use a pill radius (`borderRadius: 999`). |
| Page gutter | 24px desktop / 16px mobile | Content padding inside the main region. |
| Card padding | 24px (`p: 3`) | 16px (`p: 2`) for dense/compact cards. |
| Elevation 0 | flat + 1px `divider` border | **Default for cards and the DataTable container** — a bordered, low-shadow look reads as "records," not "floating app." |
| Elevation 1–2 | subtle shadow | App bar (1), hover lift on interactive cards (2). |
| Elevation 8 | MUI default | Dialogs/modals, menus, snackbars (focus the eye). |

**Elevation stance:** prefer **flat + hairline borders** over heavy shadows for the data-heavy surfaces; reserve real shadow for transient/floating layers (dialogs, menus, popovers, snackbars). This keeps dense screens calm.

### 2.4 Component default overrides (theme-level)

Set once in `components` so every instance is consistent:

- `MuiButton`: `disableElevation: true`, `borderRadius: 8`, default `size="medium"`; primary actions = `variant="contained"`, secondary = `variant="outlined"`, tertiary/inline = `variant="text"`.
- `MuiTextField` / `MuiSelect`: default `size="small"`, `variant="outlined"`, `fullWidth` within form layouts.
- `MuiTableCell`: `py: 1` for `size="small"` dense rows.
- `MuiTooltip`: `enterDelay: 300`; used for icon-only buttons (which also carry `aria-label`).
- `MuiChip`: pill radius; status chips driven by the `StatusBadge` mapping (§5).
- `MuiCard`: `variant="outlined"` default (flat + border).
- Focus: do **not** remove MUI's focus-visible ring; strengthen it (see §9).

### 2.5 Light/dark mode stance

**Ship light mode for v1. Architect for dark mode, do not build it yet.**

- **Rationale:** the requirements never call for dark mode; v1 scope is tight (D6 discipline). But theming via tokens (`colorSchemes`) costs little later if done from day one.
- **Mandate for Phase 6:** define the theme using **MUI v6 `colorSchemes`** with semantic tokens (not hard-coded hex inside components). Components reference `theme.palette.*`, never raw hex. This makes adding a `dark` scheme a config addition, not a refactor.
- A dark palette is sketched (primary.dark app bar, `#0A1929` canvas, `#132F4C` paper) but **not wired into a toggle in v1**. Logged as a deferred enhancement (D20).

---

## 3. Navigation Structure

### 3.1 Global navigation model

**Persistent left navigation drawer + top app bar.** This is the canonical MUI admin layout and the right fit: many modules (up to 11), frequent lateral movement, a desktop-primary audience (staff at workstations) with responsive degradation for tablet/phone.

```
┌──────────────────────────────────────────────────────────────┐
│  TOP APP BAR  [≡] School name · Logo   …  [Semester ▾][🔔][👤] │
├────────────┬─────────────────────────────────────────────────┤
│            │  Breadcrumbs: Home / Students / Ana López         │
│  LEFT      │ ┌─────────────────────────────────────────────┐  │
│  NAV       │ │  PAGE HEADER  (title + primary actions)     │  │
│  DRAWER    │ ├─────────────────────────────────────────────┤  │
│  (role-    │ │                                             │  │
│   aware)   │ │            CONTENT REGION                   │  │
│            │ │                                             │  │
│            │ └─────────────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────────┘
```

- **App bar (top, fixed):** hamburger toggle (collapses drawer), school name + logo (from Settings/branding, FR-SET-01), the **student year·semester switcher** (student role only — see below), a **notifications/announcements bell** (unread count of targeted announcements), and the **user menu** (avatar → name, role, "My account/Settings", "Log out").
- **Left drawer (permanent on desktop):** role-aware nav items grouped into sections. Active item is highlighted with `primary` accent + a left indicator bar. Collapsible to a mini icon-rail to reclaim space.

#### Academic-period selection — TWO mechanisms, not one

> ⚠️ **Corrected 2026-07-29.** This section previously specified a single global
> `SemesterSwitcher` for **all** roles. That is not what is built, and it is not what is
> wanted: the component was removed and replaced by the two mechanisms below. The
> stakeholder confirmed the split ("only student has a global switch and I want it like
> that"). Recorded here because the old text described a component that no longer exists.

- **Student → ONE global year·semester switcher** (`app/layout/StudentYearSwitcher.tsx`,
  state in `app/providers/YearContext.tsx`). Lists every year·semester pair the student was
  **enrolled in**, grouped by year, newest first (`2025-2026 · Semester 1`). Picking one
  re-scopes their whole session: My Assessments, My Grades, My Attendance, My Classes and
  My Profile. Options come from `GET /students/me/years` joined client-side to
  `GET /settings/academic-years` (which carries each year's semesters). The selection
  persists in `sessionStorage` so it survives a reload, mirroring how staff's `?year=`
  survives one. Screens send `semester_id` for semester-keyed data (assessments, grades,
  attendance) and `academic_year_id` for year-keyed data (sections, enrollment).
  - Semester names are **not** unique across years — every year has a "Semester 1" — so
    the id is the only safe identity and any label must carry the year.
- **Staff (principal / secretary / teacher) → a per-module year filter**, not a global one.
  `<YearSelect>` + `useYearFilter`, persisted in the URL as `?year=` so it survives
  refresh and back. Present on Students, Teachers, Classes, Grades, Attendance and the
  Assessments list; `StudentDetailPage` has its own variant listing only the years *that*
  student was enrolled in. Reports uses `<TermPicker>` for a per-semester report card.
- **Announcements and Calendar are deliberately NOT period-scoped** in either mechanism —
  announcements have no year or semester column at all (targeting is by audience plus
  `published_at`/`expires_at`), and the calendar is the same shared school calendar for
  everyone. The Dashboard is always the current term.
- Viewing a closed semester renders data read-only (FR-CLS-06, FR-SET-07). Both mechanisms
  feed TanStack Query keys (architecture §7.1), which is what makes a change refetch
  rather than re-serve the previous period from cache.

### 3.2 Per-role navigation map

Nav items are rendered from a **central permission map** (`shared/auth/permissions.ts`, architecture §3.2) that mirrors the requirements §2 matrix. **Hidden ≠ secured** — every route also passes a `RoleRoute` guard, and the server re-checks (NFR-SEC-01).

Legend: ✅ visible · ❌ hidden · *(scope)* = what the role sees within it.

| Nav item | Route | Principal | Secretary | Teacher | Student |
|---|---|---|---|---|---|
| **Dashboard** | `/dashboard` | ✅ school-wide | ✅ admin | ✅ own classes | ✅ own data |
| **Students** | `/students` | ✅ full | ✅ full | ✅ *(students in own classes, read-only)* | ❌ (own profile via "My Profile") |
| **Teachers** | `/teachers` | ✅ full | ✅ create-edit | ✅ *(directory, read-only)* | ❌ |
| **Classes** | `/classes` | ✅ full | ✅ create-edit | ✅ *(own classes)* | ✅ *(enrolled — "My Classes")* |
| **Assessments** | `/assessments` | ✅ view-all | ✅ view-all | ✅ *(own classes)* | ✅ *(own classes)* |
| **Grades** | `/grades` | ✅ view-all | ✅ view-all | ✅ *(enter, own classes)* | ✅ *(own — "My Grades")* |
| **Attendance** | `/attendance` | ✅ view-all | ✅ view-all | ✅ *(record, own classes)* | ✅ *(own — "My Attendance")* |
| **Announcements** | `/announcements` | ✅ full | ✅ full | ✅ *(class-scoped)* | ✅ *(targeted, read-only)* |
| **Reports** | `/reports` | ✅ school-wide | ✅ school-wide | ✅ *(own classes/students)* | ✅ *(own report card)* |
| **Settings** | `/settings` | ✅ full (school + academic) | ✅ *(limited admin config)* | ✅ *(account only)* | ✅ *(account only)* |
| **My Profile** | `/me` | — (via user menu) | — | — | ✅ *(own profile, read-only)* |

**Drawer grouping per role** (sections improve scannability and signal capability boundaries):

- **Principal** — *Overview*: Dashboard · *People*: Students, Teachers · *Academics*: Classes, Assessments, Grades, Attendance · *Communication*: Announcements · *Insights*: Reports · *Admin*: Settings.
- **Secretary** — *Overview*: Dashboard · *People*: Students, Teachers · *Academics*: Classes, Assessments, Grades, Attendance (view) · *Communication*: Announcements · *Insights*: Reports · *Admin*: Settings (limited).
- **Teacher** — *Overview*: Dashboard · *My Teaching*: My Classes, Assessments, Grades, Attendance · *People*: Students (own), Teacher Directory · *Communication*: Announcements · *Insights*: Reports (own) · *Account*: Settings.
- **Student** — *Overview*: Dashboard · *My School*: My Classes, My Grades, My Attendance, Assessments · *Report Card* (under Reports) · *Communication*: Announcements · *Account*: My Profile, Settings.

> The Student nav uses possessive labels ("My Grades", "My Attendance") to reinforce the privacy boundary (the server already scopes to the principal — architecture §3.2 — but the label sets the right expectation).

### 3.3 Collapsed / mobile navigation

- **Desktop (≥1200px):** permanent drawer, expanded (240px).
- **Laptop/tablet landscape (900–1199px):** permanent drawer, **collapsible to mini icon-rail** (72px) via the hamburger; tooltips on icons.
- **Tablet portrait / mobile (<900px):** drawer becomes a **temporary overlay** drawer (MUI `variant="temporary"`), opened by the hamburger, closes on selection or scrim tap. App bar stays fixed.
- **Phone (<600px):** same temporary drawer. The semester switcher and bell collapse into an overflow menu in the app bar to preserve space. A 4–5 item bottom navigation for a role's top tasks is a post-v1 enhancement (logged, not built — OQ-D).

---

## 4. Application Shell / Layout System

### 4.1 AppShell anatomy

`app/layout/AppShell.tsx` (architecture §5) composes:

```
AppShell
├── TopBar (AppBar)
│   ├── MenuToggle (hamburger)            — toggles Sidebar
│   ├── Brand (logo + school name)        — from Settings
│   ├── StudentYearSwitcher               — year·semester context (STUDENT ROLE ONLY)
│   ├── NotificationsBell                 — unread announcements → popover list
│   └── UserMenu (Avatar)                 — name, RoleChip, My account, Log out
├── Sidebar (Drawer, role-aware)
│   ├── NavSection[] → NavItem[]          — from permissions map
│   └── CollapseToggle                    — mini-variant on desktop
└── MainRegion
    ├── Breadcrumbs                        — derived from route
    ├── <Outlet/>                          — the routed page (uses PageHeader + content)
    └── Global mounts: SnackbarHost, ConfirmDialog root, ErrorBoundary
```

- **Skip link:** first focusable element is a visually-hidden "Skip to main content" anchor jumping to `MainRegion` (WCAG 2.4.1).
- **Single scroll owner:** the `MainRegion` content scrolls; the app bar and drawer are fixed. The page body never scrolls horizontally.

### 4.2 Responsive breakpoints & behavior

Use MUI's default breakpoints. Behavior per range:

| Breakpoint | Width | Drawer | Content columns | Tables |
|---|---|---|---|---|
| `xs` | <600 | Temporary overlay | 1 col, stacked | Card-list fallback OR horizontal scroll (per table, §8) |
| `sm` | 600–899 | Temporary overlay | 1–2 col | Reduced columns; secondary columns hidden |
| `md` | 900–1199 | Permanent, mini-collapsible | 2–3 col | Full table, horizontal scroll if needed |
| `lg` | 1200–1535 | Permanent, expanded | 3–4 col grid | Full table |
| `xl` | ≥1536 | Permanent, expanded | 4 col grid, max content width 1440px centered | Full table |

- **Forms** are max-width 640px (single-column) regardless of viewport — long line lengths hurt form completion.
- **Dashboards** use a responsive `Grid` (StatCards: 4-up `lg`, 2-up `sm`, 1-up `xs`).
- **Attendance & gradebook entry** are tablet-first (teachers use tablets/phones, NFR-RESP-01): large touch targets, sticky save bar.

### 4.3 Standard page layout template

Every routed page follows this template via the shared `PageHeader` (§5):

```
┌─────────────────────────────────────────────────────────────┐
│ Breadcrumbs                                                   │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ PAGE HEADER                                                 ││
│ │  H2 Title                          [Secondary] [Primary ▸] ││
│ │  Optional subtitle / context (e.g., "Spring 2026 · 312")   ││
│ └───────────────────────────────────────────────────────────┘│
│ ┌───────────────────────────────────────────────────────────┐│
│ │ FILTER BAR (lists only): search · filters · view toggle     ││
│ └───────────────────────────────────────────────────────────┘│
│ ┌───────────────────────────────────────────────────────────┐│
│ │ CONTENT REGION                                              ││
│ │   list | detail (tabs) | form | dashboard (grid) | report   ││
│ └───────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

- **Primary action** sits top-right of the PageHeader (one per page; role-gated — a Teacher sees "Record attendance," a Student sees no create button).
- **Page types:** `list`, `detail` (tabbed), `form` (dialog for short, full-page for long), `dashboard` (StatCard + chart grid), `report` (print-optimized).

---

## 5. Component Inventory

> Reusable components in `shared/components/` (architecture §5) mapped to MUI primitives. Feature-specific compositions live in each `features/<module>/components/`. The five named in architecture.md are marked **★**.

| # | Component | Purpose | Key props / variants | MUI building blocks |
|---|---|---|---|---|
| 1 | **DataTable** ★ | Canonical list surface: pagination, sort, filter hooks, row actions, per-row selection, integrated empty/loading/error states. | `columns`, `rows`, `loading`, `error`, `page/pageSize/total` (server-paginated `Page[T]`), `onSort`, `rowActions`, `selectable`, `getRowId`, `emptyState`, `density`. | `Table`, `TableHead/Body/Row/Cell`, `TablePagination`, `TableSortLabel`, `Checkbox`, `Menu` |
| 2 | **EmptyState** ★ | Friendly, actionable empty result. | `icon`, `title`, `description`, `action` (CTA), `variant: 'list'\|'card'\|'page'`. | `Box`, `Typography`, `Button`, `SvgIcon` |
| 3 | **LoadingState** ★ | Consistent loading: skeletons for content shape, spinner only for short blocking ops. | `variant: 'table'\|'cards'\|'form'\|'inline'`, `rows`. | `Skeleton`, `CircularProgress`, `LinearProgress` |
| 4 | **ConfirmDialog** ★ | Confirmation gate for destructive/irreversible actions; supports "type to confirm". | `open`, `title`, `body`, `confirmLabel`, `severity: 'warning'\|'error'`, `requireText?`, `loading`, `onConfirm`, `onCancel`. | `Dialog`, `DialogTitle/Content/Actions`, `Button`, `TextField` |
| 5 | **ChartWithTable** ★ | Accessible chart wrapper (NFR-A11Y-02): renders a Recharts chart **and** a toggleable data table that is the chart's text equivalent. | `chartType`, `data`, `dataKeys`, `title`, `description`, `tableColumns`, `defaultView: 'chart'\|'table'`. | Recharts (`BarChart`/`LineChart`/`PieChart`) + `DataTable` + `ToggleButtonGroup` |
| 6 | **PageHeader** | Standard page title + subtitle + breadcrumbs slot + primary/secondary actions. | `title`, `subtitle`, `breadcrumbs`, `primaryAction`, `secondaryActions[]`. | `Box`, `Typography`, `Breadcrumbs`, `Button`, `Stack` |
| 7 | **StatCard** | Dashboard metric tile: label, big value, optional delta/trend, optional sparkline, optional link. | `label`, `value`, `icon`, `trend?`, `to?`, `color`, `loading`. | `Card`, `Typography`, `SvgIcon`, Recharts mini-`LineChart` |
| 8 | **FormDialog** | Modal create/edit for short forms; wraps RHF, handles submit/loading/server errors. | `open`, `title`, `onSubmit`, `submitLabel`, `loading`, `children`. | `Dialog`, `DialogTitle/Content/Actions`, `Button`, `CircularProgress` |
| 9 | **FormPage** | Full-page form scaffold for long/complex forms (student/teacher/class). Sticky action footer. | `title`, `sections[]`, `onSubmit`, `onCancel`, `dirty`. | `Paper`, `Stack`, `Divider`, sticky `Box` |
| 10 | **FilterBar** | Search + filter controls + active-filter chips above a DataTable; pushes state to URL. | `searchPlaceholder`, `filters[]`, `activeChips`, `onChange`. | `TextField`, `Select`, `Chip`, `Stack` |
| 11 | **RoleChip** | Displays a user's role consistently. | `role: Principal\|Secretary\|Teacher\|Student`. | `Chip` (color-mapped) |
| 12 | **StatusBadge** | Single source of truth for status display (color **+ label + icon**). | `status`, `domain: 'student'\|'attendance'\|'assessment'\|'grade'\|'announcement'`. | `Chip` / `Box` + `SvgIcon` |
| 13 | **ErrorState** | Inline error surface for failed queries with retry. | `title`, `message`, `onRetry`. | `Alert`, `Button` |
| 14 | **StudentYearSwitcher** | Global year·semester selector in the app bar, **student role only**. Reads/writes `YearContext`; no props. Staff instead get a per-module `<YearSelect>` (`?year=`) — see §3.1. | — (context) | `Button` + `Menu` + `ListSubheader` |
| 14b | **YearSelect** | Per-module academic-year filter for staff list screens, beside the search bar. | `value`, `onChange`, `years[]`, `activeYearId`, `isLoading`, `label?`. | `TextField select` |
| 15 | **NotificationsBell** | Unread-announcement indicator → popover list → deep link. | `count`, `items[]`. | `Badge`, `IconButton`, `Popover`, `List` |
| 16 | **UserMenu** | Avatar → identity + account + logout. | `user`, `role`, `onLogout`. | `Avatar`, `Menu`, `MenuItem`, `RoleChip` |
| 17 | **AppShell / Sidebar / TopBar** | The shell (see §4). | role-aware nav from permission map. | `AppBar`, `Drawer`, `Toolbar`, `List`, `Breadcrumbs` |
| 18 | **DetailTabs** | Tabbed container for detail pages (Student/Class detail). | `tabs[]` (label, content, role-gated). | `Tabs`, `Tab`, `TabPanel` |
| 19 | **AttendanceSheet / AttendanceRow** | Per-student attendance toggle row + sheet (feature: attendance). | status segmented control, sticky save. | `ToggleButtonGroup`, `List`, sticky footer |
| 20 | **GradeCell** | Inline-editable numeric score cell with live letter-grade + validation. | `value`, `max`, `onChange`, `released`. | `TextField` (numeric), `Chip` (letter) |
| 21 | **PrintLayout** | Print-optimized wrapper for report card / reports (hides app chrome via `@media print`). | `header` (school identity), `children`. | `Box` + print CSS |
| 22 | **PasswordField** | Password input with show/hide + strength meter (FR-AUTH-09). | `value`, `onChange`, `showStrength`. | `TextField`, `IconButton`, `LinearProgress` |
| 23 | **CollapsibleSection** | Accessible expand/collapse section wrapper (used by the multi-year Transcript year-blocks, §7.10; reusable for grouped report views). All-expanded in print. | `title`, `summary?`, `defaultExpanded`, `children`. | `Accordion`, `AccordionSummary`, `AccordionDetails` |

**Component count: 23** shared/reusable components (the 5 named in architecture.md + 18 identified here; **#23 `CollapsibleSection` added for D24's Transcript**). Feature modules compose these; they must not invent parallel primitives (consistency principle).

---

## 6. Page Hierarchy / Sitemap

> Full screen inventory across all 11 modules, mapped to the route structure implied by architecture §5 (per-feature `routes.tsx` under `features/<module>/`). Page types: **L**=list, **D**=detail, **F**=form, **Db**=dashboard, **R**=report. Roles: P=Principal, S=Secretary, T=Teacher, St=Student (per §2 matrix).

### Module 1 — Authentication (`features/auth`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Login | `/login` | F | all (unauthenticated) |
| Forced password change (first login / admin reset) | `/login/change-password` | F | all |
| Session-expired / re-auth prompt | (modal overlay) | F | all |

### Module 2 — Dashboard (`features/dashboard`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Dashboard (role-resolved; single composite `/dashboard` endpoint) | `/dashboard` | Db | P / S / T / St (different widgets each) |

### Module 3 — Students (`features/students`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Students list | `/students` | L | P, S (full) · T (own, read-only) |
| Student detail (tabs: Profile · Classes · Grades · Attendance · Assessments) | `/students/:id` | D | P, S · T (own classes) |
| Create student | `/students/new` | F | P, S |
| Edit student | `/students/:id/edit` | F | P, S |
| Change status (deactivate/transfer/graduate) | (dialog on detail) | F | P, S |

### Module 4 — Teachers (`features/teachers`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Teachers directory | `/teachers` | L | P, S · T (read-only) |
| Teacher detail (Profile · Classes taught) | `/teachers/:id` | D | P, S · T (read-only) |
| Create teacher | `/teachers/new` | F | P, S |
| Edit teacher | `/teachers/:id/edit` | F | P · S (no delete/role change) |

### Module 5 — Classes (`features/classes`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Classes (sections) list | `/classes` | L | P, S · T (own) · St (enrolled) |
| Class (Section) detail (Roster · Subjects · Teachers · Attendance · Grades summary) | `/classes/:id` | D | P, S · T (own) · St (enrolled, limited tabs) |
| Create class (section) | `/classes/new` | F | P, S |
| Edit class / manage roster / manage subjects & assign teachers | `/classes/:id/edit` | F | P, S |

### Module 6 — Assessments (`features/assessments`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Assessments list (filter by class) | `/assessments` | L | P, S (view-all) · T (own) · St (own classes) |
| Assessment detail | `/assessments/:id` | D | all (scoped) |
| Create / edit assessment | `/assessments/new`, `/:id/edit` | F | T (own classes) |

### Module 7 — Grades (`features/grades`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Gradebook (per section-subject: students × assessment grid, grade entry) | `/grades/class-subject/:classSubjectId` | L/F | T (own subject) · P, S (view-all, read-only) |
| Grade entry for one assessment | `/grades/assessment/:assessmentId` | F | T (own) |
| My Grades (per-class, per-assessment + term grade) | `/grades/me` | L | St (own, released only) |

### Module 8 — Attendance (`features/attendance`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Attendance entry sheet (class × date) | `/attendance/class/:classId?date=` | F | T (own) |
| Attendance history / summary (per class) | `/attendance/class/:classId/history` | L/R | T (own) · P, S (view-all) |
| My Attendance (history + summary) | `/attendance/me` | L | St (own) |

### Module 9 — Announcements (`features/announcements`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Announcements list (targeted, most-recent-first) | `/announcements` | L | all (scoped) |
| Announcement detail | `/announcements/:id` | D | all (scoped) |
| Create / edit announcement | `/announcements/new`, `/:id/edit` | F | P, S (school-wide) · T (own classes) |

### Module 10 — Reports (`features/reports`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Reports hub (pick report + scope) | `/reports` | L | all (scoped) |
| Report card (per student, per term — all subjects in section) | `/reports/report-card/:studentId` (student → `/me`) | R | P, S (any) · T (own students) · St (own) |
| Transcript (per student, multi-year — all years/semesters/subjects) **(D24; P/S only per D26)** | `/reports/transcript/:studentId` | R | P, S (any) — **no T, no St** |
| Class grade summary | `/reports/class-grades/:classId` | R | P, S · T (own) |
| Attendance summary | `/reports/attendance/:classId` | R | P, S · T (own) |
| Enrollment / headcount | `/reports/enrollment` | R | P, S |

### Module 11 — Settings (`features/settings`)
| Page | Route | Type | Roles |
|---|---|---|---|
| Settings hub (tabbed) | `/settings` | D | all (tabs role-gated) |
| → School profile / branding | `/settings/school` | F | P · S (read) |
| → Academic year & semesters (active term) | `/settings/academic` | F | P |
| → Grading scale (cutoffs, pass mark) | `/settings/grading` | F | P |
| → User & role management | `/settings/users` | L/F | P · S (limited, no role change) |
| → My account (password, contact, prefs) | `/settings/account` | F | all |
| My Profile (student self-view) | `/me` | D | St |

### Cross-cutting
| Page | Route | Type | Roles |
|---|---|---|---|
| 403 Forbidden | `/forbidden` | — | all |
| 404 Not Found | `*` | — | all |

**Page count: ~51 distinct screens/routes** across the 11 modules (excluding pure dialogs, counted inline). Each dashboard variant is one route resolving role-specifically; the report card resolves `me` vs `:id`; the Transcript is a single P/S-only route (no student self-route, D26). (Net +1 vs the prior ~50: the multi-year **Transcript**, D24 — count unchanged by the D26 access restriction.)

---

## 7. Key Page Layout Specifications

> Wireframe-level (ASCII), describing regions, primary actions, and the data each shows. Not pixel-perfect. All states (loading/empty/error) follow §8/§10.

### 7.1 Login (`/login`)

```
┌───────────────────────────────────────────────┐
│              [ School Logo ]                    │
│              School Name (h1)                   │
│              "Sign in to continue"              │
│   ┌─────────────────────────────────────────┐  │
│   │ Email or username            [_________] │  │
│   │ Password                     [•••••• 👁] │  │
│   │            [   Sign in   ]               │  │ ← contained, full-width
│   │  Forgot password? Contact your school    │  │ ← admin-initiated reset (Q5)
│   │  administrator.                          │  │
│   └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```
- Single centered card (max-width 400px) on `background.default`. No left nav (unauthenticated).
- **Primary action:** Sign in. **States:** idle, submitting (button spinner + disabled), error (`Alert`: generic "Invalid credentials" — non-enumerating, FR-AUTH-02), locked ("Account temporarily locked — try again in N minutes", FR-AUTH-07).
- Password via `PasswordField` (show/hide). Enter submits. First-login/admin-reset routes to forced password change.
- A11y: `<form>` with labeled inputs, error `Alert` `role="alert"`, focus lands on first field on load.

### 7.2 Dashboards (`/dashboard`) — 4 role variants

Common frame: PageHeader "Welcome, {name}" + active-semester subtitle. Single composite `/dashboard` request (architecture §4). StatCards row (4-up `lg`) then charts (each via `ChartWithTable`) then a recent-activity column.

**Principal** (FR-DASH-02 — school-wide):
```
┌ Welcome, Principal · Spring 2026 ─────────────────────────────┐
│ [Students 312] [Teachers 28] [Classes 18] [Attendance 94%]    │ ← 4 StatCards
├───────────────────────────────────────────────────────────────┤
│ ┌ Enrollment by grade (Bar)+table┐ ┌ Attendance trend (Line) ┐ │
│ └─────────────────────────────────┘ └─────────────────────────┘ │
│ ┌ Grade distribution (Bar)+table ┐ ┌ Recent announcements ───┐ │
│ └─────────────────────────────────┘ └─────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```
StatCards: Total students, Total teachers, Classes, Overall attendance rate (current term). Charts: enrollment by grade (Bar), attendance-rate trend (Line), grade distribution (Bar). Recent school-wide announcements.

**Secretary** (FR-DASH-03 — admin tasks):
```
┌ Welcome, Secretary · Spring 2026 ─────────────────────────────┐
│ [New enrollments 7] [Classes needing setup 2] [Unassigned 4]  │
├───────────────────────────────────────────────────────────────┤
│ ┌ Quick actions ───────────────┐ ┌ Setup tasks (checklist) ──┐ │
│ │ [+Student][+Teacher]         │ │ • 2 classes w/o teacher   │ │
│ │ [+Class][+Announcement]      │ │ • 4 students unassigned   │ │
│ └──────────────────────────────┘ └───────────────────────────┘ │
│ ┌ Recent enrollments (table) ───────────────────────────────┐  │
│ └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```
Action-oriented: quick-add buttons, a "needs attention" checklist (classes without teachers, unassigned students), recent enrollments table.

**Teacher** (FR-DASH-04 — own classes, attendance-status-forward):
```
┌ Welcome, Ms. Reyes · Spring 2026 ─────────────────────────────┐
│ [My classes 4] [Attendance due today 2] [Ungraded items 3]    │
├───────────────────────────────────────────────────────────────┤
│ ┌ Today's classes ──────────────────────────────────────────┐ │
│ │ 7A Math · ⚠ Not recorded   [Record ▸]                     │ │ ← FR-ATT-08
│ │ 7B Math · ✓ Recorded        [View]                        │ │
│ │ 8A Math · ⚠ Not recorded   [Record ▸]                     │ │
│ └────────────────────────────────────────────────────────────┘ │
│ ┌ Upcoming/recent assessments ─┐ ┌ Quick actions ────────────┐ │
│ └──────────────────────────────┘ └───────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```
The "attendance recorded / not recorded per class today" list is the hero (FR-ATT-08), each row deep-linking to the attendance sheet. Plus upcoming assessments and quick links to record attendance / enter grades.

**Student** (FR-DASH-05 — own data):
```
┌ Welcome, Ana · Spring 2026 ───────────────────────────────────┐
│ [Term avg 87 (B)] [Attendance 96%] [Upcoming 2]               │
├───────────────────────────────────────────────────────────────┤
│ ┌ My classes ──────────────┐ ┌ Recent grades (released) ─────┐ │
│ └──────────────────────────┘ └───────────────────────────────┘ │
│ ┌ Upcoming assessments ────┐ ┌ Announcements (targeted) ─────┐ │
│ └──────────────────────────┘ └───────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```
StatCards: current term average + letter, attendance %, upcoming count. Then current classes, recent **released** grades (unreleased never sent — architecture §3.2/§8.5), upcoming assessments, targeted announcements.

### 7.3 Students list (`/students`)

```
Home / Students
┌ Students                                   [+ Add student] ─┐   ← primary (P,S only)
│ 312 students · Spring 2026                                   │
├──────────────────────────────────────────────────────────────┤
│ [🔍 Search name or ID] [Class ▾][Status ▾][Grade ▾]  ⌫chips  │ ← FilterBar → URL
├──────────────────────────────────────────────────────────────┤
│ ☐ ID    Name        Class  Status        Guardian   ⋮        │
│ ☐ S1012 Ana López   7A     ●Active       M. López   ⋮        │
│ ☐ S1014 Carla M.    8B     ◐Transferred  …          ⋮        │
│ … (server-paginated, sortable headers)   Rows:25▾  ◂1 2 3▸   │
└──────────────────────────────────────────────────────────────┘
```
- DataTable; columns: ID, Name (link → detail), Class/Section, Status (StatusBadge), Guardian, row-actions menu (View, Edit, Change status — gated).
- FilterBar: debounced search; filters Class / Status / Grade; active filters as removable chips; state in URL.
- **Teacher view:** read-only, scoped to students in own classes, no Add/Edit, row menu = View only.
- Empty: "No students match these filters." / "No students yet — add your first." (P/S CTA).

### 7.4 Student detail (`/students/:id`)

```
Home / Students / Ana López
┌ Ana López (S1012) ●Active           [Edit] [Change status ▾] ┐
│ 7A · Enrolled 2024-08-15 · Guardian: M. López · (501) 555-…  │
├──────────────────────────────────────────────────────────────┤
│ [Profile] [Classes] [Grades] [Attendance] [Assessments]      │ ← DetailTabs
├──────────────────────────────────────────────────────────────┤
│ (Profile)    DOB, gender, contact, guardian, address…         │
│ (Classes)    enrolled classes + teachers (table)              │
│ (Grades)     per-class term grades + per-assessment (table)   │
│ (Attendance) summary % + history table + small trend chart    │
│ (Assessments)upcoming/past assessments for enrolled classes   │
└──────────────────────────────────────────────────────────────┘
```
- Header: name, ID, StatusBadge, key facts. Actions (Edit, Change status) gated to P/S.
- Tabs lazy-load their data (separate queries). Teacher sees the same layout read-only for own-class students; cannot reach students outside own classes (guard + server). Student's own profile (`/me`) is the Profile tab only, read-only.

### 7.5 Class (Section) detail (`/classes/:id`)

> **A Class is a SECTION / homeroom (D23):** one roster, many subjects taught within it. Each subject (a `class_subjects` row) is a distinct teaching unit with its **own teacher(s) and its own gradebook**. A student enrolls in the section ONCE and is thereby a member of every subject in it. The **Subjects** tab is the hub from which each subject's gradebook, assessments, and assigned teachers are reached.

```
Home / Classes / Form 1A
┌ Form 1A · Grade 1 · Spring 2026          [Edit class] [Roster ▾] ┐
│ Homeroom · 32/35 students · 6 subjects offered                   │ ← capacity warn (FR-CLS-05/Q6)
├──────────────────────────────────────────────────────────────────┤
│ [Roster][Subjects][Teachers][Attendance][Grades summary]         │ ← DetailTabs
├──────────────────────────────────────────────────────────────────┤
│ (Roster)     section roster table; [+ Add students][Remove] (P,S) │
│ (Subjects)   subjects taught in this section (one per row):       │
│   Subject      Teacher(s)         Assessments  →                  │
│   Mathematics  Ms. Reyes          7    [Gradebook ▸][Edit]        │
│   English      Ms. Pott (+1)      5    [Gradebook ▸][Edit]        │
│   …            [+ Add subject] (P,S)                              │
│ (Teachers)   all teachers across the section's subjects; manage  │
│ (Attendance) per-section daily sheets + [Record attendance]       │
│ (Grades summary) per-subject term-grade matrix + distribution     │
└──────────────────────────────────────────────────────────────────┘
```
- Capacity shown as `32/35` on the **section** roster; over-capacity shows a `warning` chip "Over capacity" (warn-only per Q6 stance), not hard-blocked.
- **Subjects tab (the gradebook/ownership hub, D23):** lists each `class_subjects` offering for the section — subject name, assigned teacher(s), assessment count — each row linking to **that subject's gradebook** (`/grades/class-subject/:classSubjectId`, §7.7) and its assigned teacher(s). Add/remove subject offerings and assign teachers is P/S; a Teacher sees the full list but only their own subject rows are actionable (Gradebook/assessments enabled), others read-only.
- **Teachers tab:** every teacher assigned across the section's subjects (a teacher may own one or several subjects here). Co-teachers on the same subject all have full edit rights (D16/D-Q9). Assignment is per **(section, subject)**, managed from the Subjects tab or here.
- **Attendance is per-section, per-day** (D-Q4): one daily register for the homeroom, not per-subject. Any subject teacher of the section may record it. Recent sheets + [Record attendance] (Teacher); P/S reach history.
- **Grades summary tab:** a per-subject matrix (students × subjects → term grade) plus a distribution chart — the section-level rollup that feeds the report card (§7.8).
- Roster management (add/remove students from the **section**) is P/S; a Teacher sees the roster read-only but can record attendance and, for subjects they own, create assessments / enter grades.
- Student view: limited tabs (Subjects with their own per-subject grades, Assessments, their own attendance), no peer roster (privacy).

### 7.6 Attendance entry (`/attendance/class/:classId?date=`)

```
Home / Attendance / 7A Math
┌ Record attendance — 7A Mathematics                            ┐
│ Date: [ Tue, 25 Jun 2026 ▾ ]   (future dates disabled, FR-ATT-05)│
│ All present by default · 32 students · [Mark all present]      │
├──────────────────────────────────────────────────────────────┤
│ Ana López   [ Present | Absent | Late | Excused ]            │ ← segmented, default Present
│ Beto Cruz   [ Present | Absent | Late | Excused ]            │   (color+label+icon)
│ …                                                            │
├──────────────────────────────────────────────────────────────┤
│ ⓘ 3 Absent, 1 Late        [Cancel]   [ Save ]   ⟵ sticky bar │
└──────────────────────────────────────────────────────────────┘
```
- **Tablet-first.** Each row is a full-width `ToggleButtonGroup` (targets ≥44px); all default to Present (FR-ATT-02). Date picker blocks future dates (FR-ATT-05). Sticky save bar with a running count.
- Re-opening an already-recorded date loads existing statuses (upsert, FR-ATT-03) and shows "Last recorded by {name} on {time}" (FR-ATT-04 audit). Optimistic toggle with rollback (architecture §7.1). Save → success toast.
- Teacher only, own classes (guard + server, FR-ATT-09). P/S reach the **history/summary** view, not this entry sheet.

### 7.7 Gradebook / grade entry (`/grades/class-subject/:classSubjectId`)

> **One gradebook per (section, subject)** — a `class_subjects` row (D23). "Form 1A · Mathematics" and "Form 1A · English" are separate gradebooks with their own assessments, weights, and assigned teacher(s). Reached from the Class detail → Subjects tab (§7.5) or the Assessments list. The student roster shown is the **section's** roster (a student enrolled in the section appears in every subject's gradebook).

```
Home / Classes / Form 1A / Mathematics — Gradebook
┌ Gradebook — Form 1A · Mathematics · Spring 2026  [Release grades ▾]┐
│ ⓘ Unreleased grades are visible to you only                  │
├─────────┬────────┬────────┬────────┬──────────┬─────────────┤
│ Student │Quiz1/20│Test1   │ Essay  │ Term avg │ Letter      │
│         │  w10   │/100 w40│/50 w20 │(weighted)│             │
├─────────┼────────┼────────┼────────┼──────────┼─────────────┤
│ Ana L.  │ [18]   │ [92]   │ [44]   │  90.1    │ A (success) │
│ Beto C. │ [15]   │ [78]   │[exempt]│  80.0    │ B (primary) │ ← exempt removed from base
│ Carla M.│ [__]   │ [85]   │ [40]   │   …      │ …           │
├─────────┴────────┴────────┴────────┴──────────┴─────────────┤
│ ● 2 unsaved    [Cancel]            [ Save changes ] ⟵ sticky │
└──────────────────────────────────────────────────────────────┘
```
- Students (section roster) × assessment grid, scoped to this one subject. Each `GradeCell` is inline-editable numeric (0–max), validates `0 ≤ S ≤ max` (FR-GRD-02) with field-level error, derives letter live from active scale (D11, derive-on-read). "Exempt/absent" markers via cell menu (FR-GRD-05) excluded from weight base. Subject term avg recomputes on save (compute-on-read, architecture §7.1).
- **Release control** (FR-GRD-09): per-assessment or whole-subject "Release grades" → ConfirmDialog; until released, students never receive the data (server filter). An `info` banner reminds the teacher unreleased grades are private.
- Teacher edits only subjects they own (`assert_teacher_owns_class_subject`, per schema §3.C); a teacher who owns Math in this section but not English sees only the Math gradebook. P/S see the same grid **read-only** (view-all). Horizontal scroll on narrow viewports; sticky first column (Student) and sticky save bar.

### 7.8 Report card (`/reports/report-card/:studentId` | `/me`)

```
┌─────────────────────────────────────────────────────────┐
│ [Logo]  School Name · Address · Contact   (PrintLayout)  │ ← branding FR-SET-01
│ REPORT CARD — Spring 2026                                │
│ Student: Ana López (S1012) · Grade 7A                    │
├─────────────────────────────────────────────────────────┤
│ Subject     │ Score │ Letter │ Teacher                   │
│ Mathematics │  90.1 │   A    │ Ms. Reyes                 │
│ English     │  85.0 │   B    │ Ms. Pott                  │
├─────────────────────────────────────────────────────────┤
│ Attendance: 96% present (2 absences, 1 late)             │
│ Term average: 87.4 (B)                                   │
├─────────────────────────────────────────────────────────┤
│            [ 🖨 Print / Save as PDF ]   [Term ▾]          │ ← browser print (Q8 stance)
└─────────────────────────────────────────────────────────┘
```
- Print-optimized via `PrintLayout` (app chrome hidden on `@media print`). Shows school identity, **every subject in the student's section** (the `class_subjects` rollup, D23) with its score/letter/teacher, attendance summary, and the term average. Term selector (FR-RPT-07).
- The subject rows are the section's per-subject term grades for the selected term — one report card per (student, term) spanning all subjects, not one per subject.
- **Unreleased items are hidden or marked "Pending"** (AC 5.5), never shown. Student sees only own (`/me`); Teacher sees own students; P/S any student. Export = browser print/PDF (Q8 stance — confirm, OQ-A).
- A **"View full transcript"** link routes to the multi-year Transcript (§7.10) for the same student.

### 7.9 Announcements (`/announcements`)

```
Home / Announcements
┌ Announcements                          [+ New announcement] ─┐  ← P,S school-wide; T class-scoped
│ Targeted to you · most recent first                          │
├──────────────────────────────────────────────────────────────┤
│ ┌ 📌 Spring break schedule       School-wide · Principal ───┐ │
│ │ Posted Jun 24 · by A. Mendez · body preview… [Read more]  │ │
│ └────────────────────────────────────────────────────────────┘ │
│ ┌ Quiz 3 moved to Friday         7A Math · Teacher ─────────┐ │
│ │ Posted Jun 23 · expires Jun 30 · by Ms. Reyes    [⋮ edit] │ │
│ └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```
- Card list, most-recent-first (FR-ANN-03): title, audience badge, author, timestamp, expiry (if set), body preview. Edit/delete on cards the user authored (or Principal over any) — FR-ANN-04.
- **Create** (FormDialog or FormPage): title, body, audience (Teacher locked to own class(es); school-wide option absent for Teachers — FR-ANN-07), publish date, optional expiry. Student: read-only, no create.
- Expired announcements drop off recipient views (FR-ANN-05).

### 7.10 Transcript — multi-year academic record (`/reports/transcript/:studentId`)

> **New screen for D24.** A **transcript** is a per-student, multi-year academic record: every academic year → each semester → each subject taken, with its numeric + derived letter grade and a per-term/overall average. Unlike the report card (one term, §7.8), the transcript spans **all** years. The data layer assembles it as `(archived snapshot lines ∪ live current-year compute)` grouped by year → semester → subject (schema §10.6); the UI renders that hierarchy. It is a `report`-type, print-optimized page.

```
┌────────────────────────────────────────────────────────────────┐
│ [Logo]  School Name · Address · Contact        (PrintLayout)     │ ← branding FR-SET-01
│ ACADEMIC TRANSCRIPT                                              │
│ Student: Ana López (S1012) · DOB 2014-03-02 · Status: Active     │
│ Issued: 25 Jun 2026                                              │
├────────────────────────────────────────────────────────────────┤
│ ▸ 2025–2026                                          Year avg 88 │ ← academic_year block
│   ◦ Semester 1 (Fall)                              Term avg 86.0 │
│     Subject       │ Score │ Letter │ Teacher                     │
│     Mathematics   │ 90.1  │   A    │ Ms. Reyes                   │
│     English       │ 82.0  │   B    │ Ms. Pott                    │
│   ◦ Semester 2 (Spring) · current               Term avg 90.0 ⊙  │ ← live compute (⊙ = not yet frozen)
│     Mathematics   │ 92.0  │   A    │ Ms. Reyes                   │
│     English       │ 88.0  │   B    │ Ms. Pott                    │
│ ▸ 2024–2025                                          Year avg 84 │ ← archived (from snapshots)
│   ◦ Semester 1 … (collapsed)                                     │
├────────────────────────────────────────────────────────────────┤
│ Cumulative average: 86.4              [Year ▾ all][🖨 Print/PDF]  │
└────────────────────────────────────────────────────────────────┘
```

- **Layout:** a `report` page using `PrintLayout` (school identity header, app chrome hidden on `@media print`) + `PageHeader`. The body is a year → semester → subject hierarchy. Each year is a collapsible block (most recent expanded by default); each semester is a `DataTable` of subject rows (Subject · Score · Letter · Teacher). Letter grades use the same `StatusBadge`/grade-color mapping as the gradebook and report card (color + letter + number — never color alone).
- **Averages:** per-semester (term) average, optional per-year average, and a cumulative/overall average computed at assembly time (schema §10.6 stores no GPA — v1 is 0–100 numeric, D11; the average is a plain mean of term grades, weighting deferred). Labeled clearly as a computed mean, not a GPA.
- **Live vs frozen:** archived years render from frozen `term_grade_snapshots` (immutable, name/subject stable even if a subject was later renamed/retired — schema §10.6); the **active year** is live compute-on-read and is visually marked (e.g. a `⊙ current` / "not yet finalized" caption) so a reader knows it may still change. Deactivated/graduated students still resolve (RESTRICT FKs), so a leaver's transcript is intact.
- **Filters:** a Year filter (all years / a single year) in the `FilterBar`/PageHeader; default = all years, newest first.
- **Release scope:** consistent with the report card — only **released** grades appear; unreleased current-term items are hidden or marked "Pending" (AC 5.5), enforced server-side (the UI relies on never receiving unreleased data).
- **States:** loading → `LoadingState variant="table"` per year block; empty → `EmptyState` ("No academic records yet for this student" — e.g. a brand-new enrollee with no completed term); error → `ErrorState` with Retry.
- **Export:** browser Print / Save-as-PDF via the print button (Q8/OQ-A stance, consistent with the report card — no server-generated PDF in v1).
- **Role access — Principal and Secretary ONLY (D26).**
  - **Principal / Secretary:** any student's transcript (`/reports/transcript/:studentId`); reachable from the Reports hub and from a student's detail page.
  - **Teacher:** **no transcript access** — no entry point anywhere; teachers retain only their per-(section,subject) gradebook (§7.7).
  - **Student:** **no transcript view.** Students retain their own per-term **report card** (§7.8) and grades views (untouched), but not a multi-year transcript. The `/me/transcript` self-route is **removed**.
  - _Reconciles D26 (OQ-TRN): transcript = P/S only._
- **Reused components:** `PrintLayout`, `DataTable` (per-semester subject tables), `PageHeader`, `FilterBar` (Year filter), `StatusBadge`/grade-color mapping, `EmptyState`/`LoadingState`/`ErrorState`. **One new component:** **`CollapsibleSection`** (#23) — an accessible expand/collapse year-block wrapper (MUI `Accordion`-based: `role`/`aria-expanded`/`aria-controls`, keyboard operable, all-expanded for print). It is small and generic enough to also serve future grouped report views.

> **Sitemap addition:** the Transcript is one screen under Module 10 — Reports, **P/S only** (no Student self-route, D26). See §6.

---

## 8. Data Display Patterns

### 8.1 Tables (the `DataTable` contract)

- **Pagination:** always **server-side** (`Page[T]`, architecture §7.1, NFR-PERF-02). `TablePagination` footer; default page size 25, options 10/25/50. Never load full datasets.
- **Sorting:** server-driven via `TableSortLabel`; one sort column at a time; sort state in URL.
- **Filtering:** via `FilterBar` above the table; debounced search (300ms via `useDebounce`); filters/search become query-key inputs and live in the URL for deep-linking/back-button.
- **Row actions:** trailing `⋮` overflow `Menu` per row (View/Edit/Change status/Delete), each item role-gated and re-checked server-side. Destructive items route through `ConfirmDialog`.
- **Selection:** optional checkbox column for bulk ops (e.g., bulk-add students to a class); a contextual action bar appears when ≥1 row selected.
- **States (uniform across every list):**
  - *Loading:* `LoadingState variant="table"` — skeleton rows matching column shape (not a bare spinner).
  - *Empty (no data):* `EmptyState variant="list"` with a role-appropriate CTA.
  - *Empty (filtered):* "No results match your filters" + "Clear filters".
  - *Error:* `ErrorState` with Retry.
- **Responsive:** on `xs`/`sm`, low-priority columns hide (per-table `priority`); critical tables (roster, gradebook) switch to horizontal scroll within an `overflow-x:auto` container with a sticky first column. The page body itself never scrolls horizontally.

### 8.2 Forms

- **Dialog vs full-page:**
  - **FormDialog** for short forms (≤6 fields, single concern): create announcement, change status, assign teacher, reset password.
  - **FormPage** for long/multi-section forms: create/edit student, teacher, class. Sticky footer with Cancel/Save; warns on navigate-away when dirty.
- **Validation display (NFR-USE-02):** client-side via React Hook Form for instant UX, but **the server is the validation authority** (architecture §7.2). Errors are **field-level**, shown beneath the field in `error.main` with an icon; the field border turns error. On submit failure, focus moves to the first invalid field; a summary `Alert` appears for form-level/server errors. Server field errors (normalized `{ error: { fields } }`, architecture §8.1) map back to the matching fields.
- **Required fields:** marked with a visible `*` **and** `aria-required`; helper text states "Required" (never color/asterisk alone).
- **Numeric/score inputs:** constrained (min/max, numeric keyboard on mobile); grade entry validates against assessment max live.
- **Save feedback:** submit button shows inline spinner + disables; success → snackbar + close/redirect; error → keep form open, show errors, never lose input.
- **Unsaved changes:** dirty FormPage prompts a ConfirmDialog before discarding.

### 8.3 Charts (Recharts) — always via `ChartWithTable`

Every chart is wrapped in `ChartWithTable` so a non-visual user gets an equivalent **data table** (NFR-A11Y-02). Chart-type guidance:

| Data | Chart | Why | Paired table |
|---|---|---|---|
| Enrollment by grade / class | **Bar** | Compare discrete categories | grade → count |
| Enrollment trend over time | **Line** | Continuous change over terms | period → count |
| Attendance rate over time | **Line** | Trend across weeks | week → % present |
| Attendance breakdown (present/absent/late/excused) | **Stacked bar** or **Pie** (≤4 slices) | Composition | status → count/% |
| Grade distribution (A–F counts) | **Bar** | Discrete buckets | letter → count |
| Class average vs school average | **Grouped bar** | Two-series comparison | metric → value |

- **Color:** use the palette (`primary`, `secondary`, plus `info`/`success`/`warning`/`error` for grade buckets) at ≥3:1 against background; **never encode meaning by color alone** — series are labeled and the table is the source of truth.
- **Accessible defaults:** every chart has a visible `title` + `description`, `role="img"` with an `aria-label` summarizing the takeaway, a keyboard-reachable Chart ⇄ Table toggle, and a legend. Tooltips are supplementary, not the only way to read values.
- **Responsive:** `ResponsiveContainer`; on `xs` the chart may default to the table view.

---

## 9. Accessibility Specification

> Concrete WCAG 2.1 **AA** commitments (NFR-A11Y-01/02). MUI primitives give a strong baseline; these are the rules every component is held to.

### 9.1 Color & contrast (WCAG 1.4.3, 1.4.11, 1.4.1)
- Body text ≥ **4.5:1**, large text (≥18.66px bold / 24px) and UI/graphical boundaries ≥ **3:1**. The palette (§2.1) meets these on `background.paper`/`default`; `warning.main` was darkened to `#B26A00` so warning *text* clears 4.5:1.
- **Color is never the sole signal** (1.4.1): statuses, grades, chart series, and validation pair color with text/icon/shape (`StatusBadge` enforces this).

### 9.2 Keyboard (WCAG 2.1.1, 2.1.2, 2.4.3, 2.4.7)
- Every interactive element is reachable and operable by keyboard; **no keyboard traps**. Tab order follows visual order.
- **Visible focus** on all focusables: keep MUI's `focus-visible` ring, strengthened to a 2px `primary.main` outline with 2px offset (≥3:1). Never `outline:none` without a replacement.
- **Skip link** ("Skip to main content") is the first tab stop (2.4.1).
- DataTable: sort headers, row links, and the row-action menu are keyboard operable; inline `GradeCell` and attendance toggles are arrow-key/Tab navigable.

### 9.3 Focus management — dialogs, menus, drawers (WCAG 2.4.3)
- **Dialogs/FormDialog/ConfirmDialog** (MUI `Dialog`): focus moves in on open, is **trapped**, returns to the trigger on close; `Esc` closes (except in-progress destructive confirms); backdrop click closes non-destructive dialogs only.
- **Menus/Popovers/StudentYearSwitcher/UserMenu:** open with focus on first item, arrow-key navigation, `Esc` closes and restores focus.
- **Temporary nav drawer (mobile):** traps focus while open, `Esc`/scrim closes, restores focus to the hamburger.
- **Route changes:** focus moves to the page `h2` (PageHeader title) / main region, and the title is announced.

### 9.4 Semantics & ARIA (WCAG 1.3.1, 4.1.2, 4.1.3)
- **Semantic HTML/MUI semantics first**, ARIA only to fill gaps. Landmarks: `header` (app bar), `nav` (drawer), `main` (content region).
- Icon-only buttons (hamburger, bell, row `⋮`, show/hide password) carry an `aria-label`.
- **Live regions:** snackbars use `role="status"` (polite) for success/info and `role="alert"` (assertive) for errors; form-level error `Alert` is `role="alert"`. Async loading announces via `aria-busy`.
- Tabs use proper `tablist`/`tab`/`tabpanel` roles (MUI `Tabs`); sort controls expose `aria-sort`.

### 9.5 Forms (WCAG 1.3.1, 3.3.1, 3.3.2, 3.3.3)
- Every field has a **programmatically associated `<label>`** (MUI `TextField` label, not placeholder-as-label). Required fields use `aria-required` + visible "Required" helper.
- Errors are linked via `aria-describedby`, announced, and described in text (not color alone) with a **suggestion** where possible (3.3.3: "Score can't exceed 100").
- Grouped controls (attendance status, audience radios) use `fieldset`/`legend` or `role="radiogroup"` with a group label.

### 9.6 Charts (NFR-A11Y-02, WCAG 1.1.1)
- Every Recharts chart is wrapped by `ChartWithTable`: a parallel **data table** is the text equivalent, the chart container has `role="img"` + a summarizing `aria-label`, and a keyboard-operable toggle switches views. No information exists only in the visual.

### 9.7 Responsive & target size (WCAG 1.4.10, 2.5.5 / 2.5.8)
- Layouts reflow to 320px wide with no loss of content or horizontal page scroll (1.4.10); wide tables scroll within their own container.
- Touch targets ≥ **44×44px** (attendance toggles, grade cells, row actions, mobile nav items) — critical for the tablet attendance flow.
- Respect `prefers-reduced-motion`: skeleton shimmer and transitions reduce to instant/none.

### 9.8 Process
- Components are built against these rules from the start; Phase 8 QA includes an axe/Lighthouse pass and a keyboard-only walkthrough of the 7 core flows. Target: zero AA violations on core flows.

---

## 10. Interaction & Feedback Patterns

> Coordinated with the TanStack Query strategy (architecture §7) and shared components (§5).

### 10.1 Loading strategy
- **Skeletons for content shape** (lists, dashboards, detail tabs) via `LoadingState` — no layout jump when data arrives. **Spinners only** for short blocking actions (button submit) and indeterminate waits where shape is unknown.
- **App bootstrap:** while `AuthProvider` performs the silent `/auth/refresh` (architecture §3.1), route guards show a full-screen `LoadingState` until auth resolves — prevents a flash of the login screen on hard reload.
- **Per-query granularity:** detail tabs and dashboard widgets load independently (own queries) so one slow widget doesn't block the page.

### 10.2 Mutation feedback — snackbars/toasts
- Every mutation (create/update/delete/save/release) produces a **snackbar** via a single `SnackbarHost`: success (`success`, auto-dismiss ~4s, `role="status"`), error (`error`, manual dismiss + Retry where safe, `role="alert"`).
- Concise and specific: "Attendance saved for 7A · Jun 25", "Grades released to 32 students", "Couldn't save — try again".
- One snackbar at a time (queued); positioned bottom-center, not obscuring the sticky save bar on mobile.

### 10.3 Error states
- **Query errors:** the affected region renders `ErrorState` (title + message + Retry), not a blank screen. Global render crashes are caught by a React `ErrorBoundary` with a recoverable fallback.
- **Authorization (403):** redirect to `/forbidden` for navigation; for an in-page action, a snackbar "You don't have permission for that." (mirrors server enforcement, NFR-SEC-01).
- **Session expiry (401, FR-AUTH-10):** the API client's single-flight refresh attempts silent renewal; if it fails, a **re-auth modal** appears (or redirect to `/login` preserving the return path) — work-in-progress isn't silently lost where avoidable.
- Errors are human and never expose internals/codes; field errors are inline (§8.2).

### 10.4 Confirmation flows (destructive actions)
- All destructive/irreversible actions route through **`ConfirmDialog`** with clear consequence text and a typed `error`-colored confirm button: delete announcement, remove student from roster, deactivate student/teacher, delete assessment, **release grades** (consequential).
- **Guard-aware messaging:** where the server blocks an action (delete a student with grades — FR-STU-10; delete an assessment with grades — FR-ASMT-07; delete a class/teacher with history — FR-CLS-08/FR-TCH-06), the UI **anticipates** it: the action is disabled with a tooltip explaining why ("Has grades — deactivate instead"), or the dialog explains the block and offers the allowed alternative. The server remains the final authority.
- High-impact bulk actions (bulk remove from roster) require a "type to confirm" (`requireText`).

### 10.5 Optimistic updates (stance, per architecture §7.1)
- **Use optimistically (with rollback on error):** high-frequency teacher toggles — attendance status changes, grade-cell edits within an unsaved batch — so the UI feels instant. On error, roll back the cache and show an error snackbar.
- **Do NOT use optimistically:** creates/deletes, status changes, grade *release*, and anything with server-side guards/derivations the client can't reliably predict — show a pending state and reconcile from the server response. After any mutation, invalidate the narrowest relevant query key(s) (architecture §7.1) so views refresh without a reload (NFR-PERF-03).

### 10.6 Microinteractions & motion
- Subtle, fast (150–200ms) transitions on drawer, dialog, snackbar, tab change — MUI defaults. No decorative animation. All motion respects `prefers-reduced-motion` (§9.7).

---

## 11. New Decisions & Open Questions for the Orchestrator

> Items to log in `complete-work.md`. None block Phase 4 (DB) or Phase 5 (API); they are frontend-facing and confirmable.

**New design decisions (proposed — recommend logging as D18–D22):**

- **D18 — Navigation model:** persistent left nav **drawer + top app bar**, role-aware via the central permission map; mini-collapsible on `md`, temporary overlay on `<900px`. Active **semester switcher** in the app bar as global term context.
- **D19 — Theme tokens:** **MUI v6 token-driven theme** (primary `#1F5BA8` blue, secondary `#0E7C7B` teal, semantic status set; 8px spacing; 8px radius; flat-with-hairline-border surfaces; system font stack with optional self-hosted Inter; buttons/tabs `textTransform:'none'`). Defined via `colorSchemes` so dark mode is later a config change.
- **D20 — Light mode only for v1; dark mode deferred** but architected (token-driven, no hard-coded hex in components).
- **D21 — Density:** "comfortable-compact" — dense `size="small"` tables/lists where staff scan data; comfortable forms/reading surfaces.
- **D22 — Mobile support level:** **responsive web, no native app** (confirms D6). **Tablet-first** for attendance and gradebook entry (teachers); full parity on desktop; phone supported via overflow/temporary-drawer adaptations. Phone bottom-nav is a logged post-v1 enhancement.

**Open questions / confirmations the orchestrator should track:**

- **OQ-A (Q8 dependency):** Report export is specced as **browser print / Save-as-PDF** (`PrintLayout`). If stakeholders need official server-generated PDF (letterhead/signatures), that changes Reports in Phase 7 — confirm before Phase 7-Reports. (Matches existing Q8 stance.)
- **OQ-B (Q5 surfacing):** Login uses **admin-initiated password reset** copy ("Contact your administrator") — no self-service reset UI in v1. Confirm the user-facing message (matches D5/Q5 stance).
- **OQ-C — Self-hosted Inter font:** optional enhancement; default to the system/Roboto stack if self-hosting adds ops cost. No functional impact (tied to D19).
- **OQ-D — Phone bottom-navigation:** deferred to post-v1; confirm acceptable that phone uses the temporary drawer only for v1.
- **OQ-E — Notifications bell scope:** v1 bell = unread **in-app announcements** count only (no external delivery — A-IN-APP-ANNOUNCEMENTS). Confirm no other notification types expected for v1.

**Downstream notes for later phases:**
- **Phase 4 (DB):** the UI assumes a per-user `display preferences` store (locale, possibly future theme) on the account (FR-SET-05) and the student↔user / teacher↔user linkage (architecture §3.2) to drive "My …" pages.
- **Phase 5 (API):** the composite `/dashboard` endpoint must return role-shaped payloads matching the 4 dashboard specs (§7.2); lists must honor the `Page[T]` + sort/filter params the `DataTable`/`FilterBar` push to the URL; report-card/grade reads must already exclude unreleased data server-side (the UI relies on never receiving it).
- **Phase 6/7:** build the 23 shared components (§5) first (foundation), then features in the D17 dependency order.
- **Phase 4.5 reconciliation (D23/D24):** §7.5 (Class = SECTION with explicit Subjects tab + per-section attendance), §7.7 (gradebook is per `class_subjects`, route `/grades/class-subject/:classSubjectId`, ownership via `assert_teacher_owns_class_subject`), §7.8 (report card = all section subjects + link to transcript), and the new §7.10 Transcript were aligned to the D23 section model and the D24 multi-year transcript (schema §10.6). The gradebook/report-card wireframes already assumed per-subject grading, so D23 was a wording/routing alignment, not a redesign; D24 added one screen and one component (`CollapsibleSection`).

---

_End of Phase 3 UI/UX design. Next: orchestrator review → update `complete-work.md` (log D18–D22, OQ-A..E) → Phase 4 (Database Design)._
