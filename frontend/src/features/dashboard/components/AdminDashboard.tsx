import { useId } from 'react';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { ChartWithTable } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type {
  AdminDashboard as AdminDashboardData,
  AuditorDashboard as AuditorDashboardData,
} from '../types';
import { AnnouncementsList } from './AnnouncementsList';
import { PeopleListCard } from './PeopleListCard';

/**
 * Dean dashboard (design-system §7.2 — school-wide analytics), §42's KPI set.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * D46 — REDESIGN. Why the previous version was wrong, and what replaced it.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * The previous layout was twelve near-identical `StatCard`s in one flat 4-up grid,
 * separated by three ALL-CAPS `overline` band labels. Every tile had the same border,
 * the same tinted icon chip, the same helper-text slot and the same weight — so
 * "8 active programmes" (a number nobody has ever acted on) and "12 applicants waiting
 * on a decision" (twelve people whose lives are on hold) were rendered identically.
 * That is the generic SaaS card kit: no hero, no hierarchy, and it forces the Dean to
 * read all twelve numbers to discover that only two of them matter today.
 *
 * **The principle this page is now built on:** *a Dean opens this page to find out
 * whether anything needs them today, and only then to see how the college is doing.*
 * Everything below follows from that one sentence.
 *
 * **The governing system rule: an icon on this page means "this needs a person."**
 * Icons appear ONLY inside the attention panel (plus the check mark that says a queue is
 * clear). The old design put an icon chip on all twelve tiles, which made the chip
 * meaningless decoration. Removing icons from every non-actionable figure is the single
 * biggest reason this page now reads as three different kinds of information rather than
 * twelve of the same thing.
 *
 * ── The hero, and why it is this ────────────────────────────────────────────────
 *
 * The hero is the **"Needs you today" panel**, not a metric tile.
 *
 * There is no single number that answers "does anything need me". The four work queues
 * — applicants awaiting a decision, accepted students not yet enrolled, students below
 * the attendance floor, and marking still outstanding — are heterogeneous: different
 * urgencies, different destinations, different people waiting. Summing them into one big
 * "14 items need you" figure would be a fabricated metric: you cannot act on a sum, and
 * no screen exists that clears it. So the hero is a REGION: one full-width panel, first
 * on the page, carrying the largest type on the screen (2rem — larger than the page
 * title itself, because the count is the point).
 *
 * **The move that makes this page specific rather than templated: an empty queue does
 * not get a tile.** Cleared queues collapse into one quiet line at the foot of the panel
 * ("Clear: no applicant is waiting on a decision · no marking is outstanding"), and when
 * all four are clear the panel becomes a single calm statement — a heading saying nothing
 * needs attention plus one sentence enumerating the four things that are fine, so the
 * Dean can trust the all-clear rather than wonder what it covered. The hero therefore
 * *physically shrinks as the Dean does their job*, which is the opposite of a status
 * board that renders four green zeros and demands to be read anyway.
 *
 * Rows are ordered by URGENCY, not by size:
 *   1. Students below the attendance floor — a student failing out is time-critical and
 *      the damage is not recoverable later in the session.
 *   2. Applicants waiting on a decision — people outside the college waiting on us.
 *   3. Assessments still being marked — internal, but it blocks report cards.
 *   4. Accepted, not yet enrolled — real, but the next move is partly theirs.
 *
 * The counts render in `text.primary`, NOT in their severity colour. Severity is carried
 * by the tinted icon chip, the row order and an explicit action verb — so the panel does
 * not read as a traffic light, contrast stays maximal, and nothing depends on colour
 * alone (WCAG 1.4.1).
 *
 * ── What was cut or demoted, and why ────────────────────────────────────────────
 *
 *  · **The three ALL-CAPS band labels are gone.** Grouping is structural now: each tier
 *    is its own panel with its own sentence-case heading inside it. A floating caps
 *    eyebrow was labelling a grid that had no visual boundary; a panel needs no eyebrow.
 *  · **Six "how big is the college" tiles → one ledger strip.** Students, new intake,
 *    attendance, lecturers and courses are cells of a single bordered panel: label,
 *    figure, and a unit/denominator caption. Hairline-divided on desktop; on a phone each
 *    becomes an actual ledger line (label left, figure right). No icons, no cards.
 *  · **Programmes and graduates were demoted to one footer line.** "8 programmes" never
 *    changes and nobody acts on it; "graduates to date" is cumulative and undated. They
 *    are two quiet links in an "Also" row rather than two tiles the size of a work queue.
 *  · **The seats-filled progress bar was cut.** "of 460 seats filled" states it in words
 *    in the Students caption; a 6px bar added a visual encoding for a figure that is
 *    neither a queue nor a ranking.
 *  · **Empty charts are no longer rendered.** The old code passed `?? []` straight to
 *    `ChartWithTable`, so a server without `enrollment_trend` drew an empty pair of axes
 *    titled "Enrollment trend". Charts with no rows are dropped and the survivors share
 *    the width. Same for the two people lists, which otherwise showed empty-state cards
 *    on a page whose whole point is "here is what is NOT empty".
 *  · **`categoryLabel` on the enrolment chart said "Grade".** Stale from before D31 — the
 *    bars are programmes. Fixed.
 *  · **Courses now links to the CATALOG (`ROUTES.courses`), not `ROUTES.offerings`.** The
 *    figure is `total_courses`, a catalog count; it was landing on the offerings screen.
 *
 * ── Critique pass (the plan was revised before it was built) ─────────────────────
 *
 * The first draft of this design was: hero action-list + a KPI row with dividers + a big
 * percentage + a ranked table. Read back, that is the standard "action items widget +
 * stat strip" every admin template ships. Three revisions came out of that critique, and
 * they are what the code actually does:
 *   1. Empty queues collapse instead of rendering as tiles (above) — no template does
 *      this, and it is the behaviour that matches a Dean's morning.
 *   2. Icons became a rule with meaning ("this needs a person") instead of decoration
 *      applied evenly, which is what let tier 2 shed its card-ness entirely.
 *   3. The stat strip committed to being a LEDGER — captions are units and denominators
 *      ("of 460 seats filled", "18 offerings running"), not marketing helper text, and on
 *      mobile it reads as ruled ledger lines rather than restacked cards.
 *
 * ── Palette roles (theme tokens only; no raw hex anywhere in this file) ─────────
 *
 *   `primary.main`   BAJC navy. The hero's 4px masthead rule (a letterhead device — the
 *                    aesthetic §1.1 asks for is a well-run records office), plus every
 *                    link/affordance colour. The institutional voice.
 *   `error.main`     Students below the attendance floor; the failure-rate rank bars.
 *   `warning.main`   Applicants waiting; marking outstanding.
 *   `info.main`      Accepted, not yet enrolled — a follow-up, not a problem.
 *   `success.main`   The all-clear and the "Clear:" band. Never a green zero.
 *   `secondary.main` DELIBERATELY UNUSED. The seal's crimson would be a second red
 *                    competing with `error` on a triage page.
 *   `text.secondary` / `divider` / `background.paper` — everything else, quiet.
 *   Tints via `alpha()` only (icon chips 0.12, the clear band 0.04, rank bars 0.6).
 *
 * ── Type scale (three steps, all existing theme variants) ───────────────────────
 *
 *   h1 2.00rem/700   queue counts — the biggest thing on the page, on purpose
 *   h2 1.50rem/700   the failure-rate figure (the one outcome that earns a panel)
 *   h3 1.25rem/600   the hero heading; ledger figures
 *   h4 1.125rem/600  panel headings (matches `ChartWithTable`'s own title variant)
 *   subtitle1 / body2 / caption   labels, action verbs, denominators
 *
 * Heading levels: `PageHeader` owns the `h1`, panels are `h2`, and `ChartWithTable` emits
 * `h3` titles — so the document outline never skips a level.
 *
 * ── Layout ──────────────────────────────────────────────────────────────────────
 *
 * Desktop (lg):
 *
 *   ┌─ 4px navy rule ───────────────────────────────────────────────────────────┐
 *   │  Needs you today                                                          │
 *   │  [!] 12  Students below the attendance floor   Review attendance alerts › │
 *   │  ───────────────────────────────────────────────────────────────────────  │
 *   │  [≡]  7  Applicants waiting on a decision      Open admissions          › │
 *   │  ───────────────────────────────────────────────────────────────────────  │
 *   │  [✎] 23  Assessments still being marked        Open the gradebook       › │
 *   │  ✓ Clear: no accepted student is left to enrol                            │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *   ┌─ The college ─────────────────────────────────────────────────────────────┐
 *   │ Students │ New this session │ Attendance │ Lecturers │ Courses            │
 *   │ 412      │ 96               │ 92%        │ 34        │ 114                │
 *   │ of 460…  │ first-year…      │ this sess. │ teaching  │ 18 offerings…      │
 *   │ ───────────────────────────────────────────────────────────────────────── │
 *   │ Also  8 programmes · 431 graduates to date                                │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *   ┌─ Academic outcomes ─────────────┬─────────────────────────────────────────┐
 *   │ 14%                             │ Course      Results Failing  Rate       │
 *   │ of resolved grades came back…   │ MTH101       32      9       28% ▁▃▃    │
 *   │ Open the gradebook ›            │ ACC201       28      7       25% ▁▂▂    │
 *   └─────────────────────────────────┴─────────────────────────────────────────┘
 *   ┌ chart ─────────┬ chart ─────────┬ chart ─────────┐   (the width is shared by
 *   ┌ Lecturers ─────┬ Students ──────┬ Announcements ─┐    whichever ones exist)
 *
 * Mobile (390px): every panel is full width; queue rows keep chip + count + label + verb;
 * ledger cells become ruled lines (label ......... figure  caption); the courses table
 * folds each title under its course code and scrolls horizontally only if the three
 * numeric columns still do not fit.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────────
 *
 * Exactly one moment, and it is functional rather than decorative: the chevron on a queue
 * row slides 3px on hover/focus, so the largest click target on the page confirms that it
 * is a link. Nothing fades, nothing slides up on mount. A `prefers-reduced-motion` block
 * removes both the transition and the transform.
 *
 * ── Deep links (every count is a real `RouterLink`, so middle-click, ctrl-click and a
 *    screen reader's link list all work) ──────────────────────────────────────────
 *
 *   Students at risk        → `${ROUTES.attendance}/alerts`
 *   Attendance rate         → `${ROUTES.attendance}/summary`
 *   Applicants waiting      → `${ROUTES.applications}?status=submitted`
 *   Accepted, not enrolled  → `${ROUTES.applications}?status=accepted`
 *   Graduates               → `${ROUTES.students}?status=Graduated`
 *   Marking outstanding     → `ROUTES.grades`     (no finer anchor exists)
 *   Failure rate / courses  → `ROUTES.grades`     (same; NOT faked per course — the
 *                                                  panel links once instead of giving
 *                                                  eight rows eight identical links)
 *   Total students          → `ROUTES.students`
 *   New students            → `ROUTES.students`   (server-derived from enrolment dates;
 *                                                  there is no matching student filter)
 *   Courses                 → `ROUTES.courses`
 *   Lecturers               → `ROUTES.teachers`
 *   Programmes              → `ROUTES.programs`
 *
 * ── Unchanged, and still true ───────────────────────────────────────────────────
 *
 * The shared `StatCard` is no longer used here (the Secretary, Lecturer and Student
 * dashboards still use it and must not be disturbed); `ChartWithTable`, `PeopleListCard`
 * and `AnnouncementsList` are used as-is. "Applicants waiting" is a QUEUE, never a
 * running total of everyone who ever applied. "Graduates" says **to date**, because
 * `graduation_date` is NULL across the register and there is no year to scope by.
 * `students_at_risk` counts distinct students, not alert rows. `failure_rate`'s
 * denominator is resolved grades, never enrolments. And §42's "students on probation"
 * and "graduation candidates" are still absent rather than faked with a zero — those
 * features (Academic Standing C1, Graduation Audit C2) do not exist yet.
 */
export interface AdminDashboardProps {
  /** D43 — also accepts the Auditor variant: the same school-wide payload, read-only. */
  data: AdminDashboardData | AuditorDashboardData;
}

type Severity = 'error' | 'warning' | 'info';

/** One work queue in the hero panel. */
interface AttentionItem {
  key: string;
  count: number;
  /** What the queue IS, as a noun phrase. */
  label: string;
  /** What clicking through lets the Dean DO. Two to four words. */
  action: string;
  /** How this queue reads when it is EMPTY — this also builds the all-clear sentence. */
  clear: string;
  to: string;
  severity: Severity;
  icon: ReactNode;
}

/** One cell of the "The college" ledger strip. */
interface LedgerFigure {
  key: string;
  label: string;
  value: string;
  /** A unit or a denominator, never marketing copy. */
  caption: string;
  to: string;
}

/** "a, b and c." — so the all-clear reads as one sentence rather than a list of zeros. */
function toSentence(parts: string[]): string {
  if (parts.length === 0) return '';
  const joined =
    parts.length === 1
      ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/**
 * A queue row. The whole row is one link, so the target is ~76px tall and the count, the
 * label and the verb all sit inside it. The accessible name states the count, the queue
 * and the action, which is what makes it useful in a screen reader's link list.
 */
function QueueRow({ item, divided }: { item: AttentionItem; divided: boolean }) {
  return (
    <ButtonBase
      component={RouterLink}
      to={item.to}
      aria-label={`${item.count} — ${item.label}. ${item.action}`}
      sx={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'flex-start',
        textAlign: 'left',
        gap: { xs: 1.5, sm: 2 },
        px: { xs: 2, sm: 3 },
        py: 2,
        minHeight: 76,
        borderTop: divided ? 1 : 0,
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
        // The page's one motion moment: an affordance on its largest target.
        '& .queue-chevron': { transition: 'transform 140ms ease-out' },
        '&:hover .queue-chevron, &.Mui-focusVisible .queue-chevron': {
          transform: 'translateX(3px)',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '& .queue-chevron': { transition: 'none' },
          '&:hover .queue-chevron, &.Mui-focusVisible .queue-chevron': { transform: 'none' },
        },
      }}
    >
      <Box
        aria-hidden
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 1.5,
          color: theme.palette[item.severity].main,
          bgcolor: alpha(theme.palette[item.severity].main, 0.12),
        })}
      >
        {item.icon}
      </Box>
      <Typography
        variant="h1"
        component="p"
        sx={{
          lineHeight: 1,
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
          minWidth: { xs: 44, sm: 60 },
        }}
      >
        {item.count}
      </Typography>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="subtitle1" component="p">
          {item.label}
        </Typography>
        <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600 }}>
          {item.action}
        </Typography>
      </Box>
      <ChevronRightIcon
        className="queue-chevron"
        aria-hidden
        fontSize="small"
        sx={{ color: 'primary.main', flexShrink: 0 }}
      />
    </ButtonBase>
  );
}

/**
 * The hero. Renders only the queues that have something in them, names the cleared ones
 * in one line, and collapses to a single calm statement when every queue is clear.
 */
function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const headingId = useId();
  const live = items.filter((i) => i.count > 0);
  const cleared = items.filter((i) => i.count <= 0);
  const allClear = live.length === 0;

  return (
    <Card
      component="section"
      aria-labelledby={headingId}
      // The masthead rule. A letterhead device rather than a gradient: it says "this is
      // the top of the document" in the institution's own navy.
      sx={{ borderTop: 4, borderTopColor: 'primary.main' }}
    >
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: allClear ? 0 : 1.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {allClear && (
            <Box
              aria-hidden
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: 1.5,
                color: theme.palette.success.main,
                bgcolor: alpha(theme.palette.success.main, 0.12),
              })}
            >
              <CheckCircleOutlineIcon />
            </Box>
          )}
          <Typography id={headingId} variant="h3" component="h2">
            {allClear ? 'Nothing needs your attention' : 'Needs you today'}
          </Typography>
        </Stack>
      </Box>

      {allClear ? (
        // ONE statement, enumerated so the all-clear is trustworthy rather than vague.
        <Box sx={{ px: { xs: 2, sm: 3 }, pt: 1, pb: { xs: 2, sm: 2.5 } }}>
          <Typography variant="body2" color="text.secondary">
            {toSentence(items.map((i) => i.clear))}
          </Typography>
        </Box>
      ) : (
        <>
          {live.map((item, i) => (
            <QueueRow key={item.key} item={item} divided={i > 0} />
          ))}
          {cleared.length > 0 && (
            <Stack
              direction="row"
              spacing={1}
              sx={(theme) => ({
                alignItems: 'center',
                flexWrap: 'wrap',
                px: { xs: 2, sm: 3 },
                py: 1.5,
                borderTop: 1,
                borderColor: 'divider',
                bgcolor: alpha(theme.palette.success.main, 0.04),
              })}
            >
              <CheckCircleOutlineIcon aria-hidden fontSize="small" sx={{ color: 'success.main' }} />
              <Typography variant="body2" color="text.secondary">
                Clear: {cleared.map((c) => c.clear).join(' · ')}
              </Typography>
            </Stack>
          )}
        </>
      )}
    </Card>
  );
}

/** A plain content panel: heading, optional denominator caption, body. */
function Panel({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card component="section" aria-labelledby={headingId} sx={{ height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography id={headingId} variant="h4" component="h2">
          {title}
        </Typography>
        {caption && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {caption}
          </Typography>
        )}
        <Box sx={{ mt: 2 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

/**
 * One ledger cell: ruled columns on desktop, a ruled LINE on a phone (label left, figure
 * right, denominator trailing) — the form of a records-office summary line, not a card.
 * No icon: on this page an icon means "a person is needed", and none of these need one.
 */
function LedgerCell({ figure, index }: { figure: LedgerFigure; index: number }) {
  return (
    <ButtonBase
      component={RouterLink}
      to={figure.to}
      aria-label={`${figure.label}: ${figure.value}`}
      sx={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: { xs: 'row', md: 'column' },
        alignItems: { xs: 'baseline', md: 'flex-start' },
        justifyContent: 'flex-start',
        textAlign: 'left',
        gap: { xs: 1, md: 0.25 },
        width: '100%',
        minHeight: 56,
        px: { xs: 0, md: 2 },
        py: 1.5,
        borderRadius: 0,
        borderTop: { xs: index > 0 ? 1 : 0, md: 0 },
        borderLeft: { xs: 0, md: index > 0 ? 1 : 0 },
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ flexGrow: { xs: 1, md: 0 }, minWidth: 0 }}
      >
        {figure.label}
      </Typography>
      <Typography
        variant="h3"
        component="p"
        sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
      >
        {figure.value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
        {figure.caption}
      </Typography>
    </ButtonBase>
  );
}

export function AdminDashboard({ data }: AdminDashboardProps) {
  const { stats } = data;

  // D31: bucketed by PROGRAMME, not by Form. The bar label is the programme CODE
  // ("BMAD") — a chart axis has no room for "Business Administration", and the code is
  // what BAJC prints on a report card anyway.
  const enrollmentData = data.enrollment_by_programme.map((d) => ({
    name: d.programme_code,
    value: d.count,
  }));
  const gradeData = data.grade_distribution.map((d) => ({ name: d.letter, value: d.count }));
  const trendData = (data.enrollment_trend ?? []).map((d) => ({ name: d.period, value: d.count }));

  const capacity = stats.student_capacity ?? 0;
  const failureRate = stats.failure_rate ?? 0;
  const worstCourses = data.course_failure_rates ?? [];
  const teachers = data.recent_teachers ?? [];
  const students = data.recent_students ?? [];

  // ── The hero's four queues, in urgency order (the defence is in the docstring).
  const attention: AttentionItem[] = [
    {
      key: 'at-risk',
      count: stats.students_at_risk,
      // Distinct students, not alert rows: someone failing three classes is one student
      // at risk, and the server counts them that way.
      label: 'Students below the attendance floor',
      action: 'Review attendance alerts',
      clear: 'no one is below the attendance floor',
      to: `${ROUTES.attendance}/alerts`,
      severity: 'error',
      icon: <WarningAmberIcon />,
    },
    {
      key: 'applicants',
      count: stats.new_applicants,
      // A QUEUE. Not a running total of everyone who ever applied — that would only ever
      // go up and would tell the Dean nothing to act on.
      label: 'Applicants waiting on a decision',
      action: 'Open admissions',
      clear: 'no applicant is waiting on a decision',
      to: `${ROUTES.applications}?status=submitted`,
      severity: 'warning',
      icon: <AssignmentIndOutlinedIcon />,
    },
    {
      key: 'marking',
      count: stats.outstanding_grade_submissions,
      label: 'Assessments still being marked',
      action: 'Open the gradebook',
      clear: 'no marking is outstanding',
      to: ROUTES.grades,
      severity: 'warning',
      icon: <RateReviewOutlinedIcon />,
    },
    {
      key: 'accepted',
      count: stats.accepted_applicants,
      label: 'Accepted, not yet enrolled',
      action: 'Finish registration',
      clear: 'no accepted student is left to enrol',
      to: `${ROUTES.applications}?status=accepted`,
      severity: 'info',
      icon: <HowToRegOutlinedIcon />,
    },
  ];

  // ── The ledger. A figure the server did not send is OMITTED, never defaulted to 0:
  // "0 new students this session" is a claim, and it is one the Dean would believe.
  const ledger: LedgerFigure[] = [
    {
      key: 'students',
      label: 'Students',
      value: String(stats.active_students),
      caption: capacity > 0 ? `of ${capacity} seats filled` : 'registered and active',
      to: ROUTES.students,
    },
    ...(typeof stats.new_students_term === 'number'
      ? [
          {
            key: 'new-students',
            label: 'New this session',
            value: String(stats.new_students_term),
            caption: 'first-year intake',
            to: ROUTES.students,
          },
        ]
      : []),
    {
      key: 'attendance',
      label: 'Attendance',
      value: `${stats.attendance_rate}%`,
      caption: 'college-wide, this session',
      to: `${ROUTES.attendance}/summary`,
    },
    {
      key: 'lecturers',
      label: 'Lecturers',
      value: String(stats.active_teachers),
      caption: 'active teaching staff',
      to: ROUTES.teachers,
    },
    {
      key: 'courses',
      // The catalog count, so the link goes to the catalog. `total_sections` is the
      // offering count and rides along as the caption rather than as a second tile.
      label: 'Courses',
      value: String(stats.total_courses ?? stats.total_sections),
      caption: `${stats.total_sections} offerings running`,
      to: ROUTES.courses,
    },
  ];

  // ── Charts: only the ones that have rows. An empty `ChartWithTable` renders a titled
  // pair of empty axes, which reads as "we have no students" rather than "not sent".
  const charts = [
    {
      key: 'enrollment',
      title: 'Enrollment by programme',
      type: 'bar' as const,
      data: enrollmentData,
      categoryLabel: 'Programme',
    },
    {
      key: 'grade-distribution',
      title: 'Grade distribution',
      type: 'bar' as const,
      data: gradeData,
      categoryLabel: 'Letter',
    },
    {
      key: 'trend',
      title: 'Enrollment trend',
      type: 'line' as const,
      data: trendData,
      categoryLabel: 'Session',
    },
  ].filter((c) => c.data.length > 0);
  const chartSpan = charts.length > 0 ? 12 / charts.length : 12;

  // ── Lists: the same rule. Two empty-state cards under a page about what needs
  // attention are two cards saying "nothing", which the hero already says better.
  const lists: { key: string; node: ReactNode }[] = [];
  if (teachers.length > 0) {
    lists.push({
      key: 'teachers',
      node: (
        <PeopleListCard
          title="Lecturers"
          people={teachers}
          viewAllTo={ROUTES.teachers}
          emptyText="Teaching staff will appear here."
        />
      ),
    });
  }
  if (students.length > 0) {
    lists.push({
      key: 'students',
      node: (
        <PeopleListCard
          title="Students"
          people={students}
          viewAllTo={ROUTES.students}
          emptyText="Enrolled students will appear here."
        />
      ),
    });
  }
  lists.push({
    key: 'announcements',
    node: (
      <AnnouncementsList
        title={`Recent announcements${
          stats.unread_announcements > 0 ? ` (${stats.unread_announcements} unread)` : ''
        }`}
        announcements={data.recent_announcements}
      />
    ),
  });
  const listSpan = 12 / lists.length;

  return (
    <Grid container spacing={3}>
      {/* ── The hero ─────────────────────────────────────────────────────────── */}
      <Grid item xs={12}>
        <AttentionPanel items={attention} />
      </Grid>

      {/* ── The college: one ledger, not six cards ───────────────────────────── */}
      <Grid item xs={12}>
        <Panel title="The college" caption="Current session, unless the figure says otherwise.">
          <Grid container>
            {ledger.map((figure, i) => (
              <Grid item xs={12} md key={figure.key} sx={{ display: 'flex' }}>
                <LedgerCell figure={figure} index={i} />
              </Grid>
            ))}
          </Grid>
          {/* The two figures nobody acts on. Present and linked, but one line of text —
              not two tiles the size of a work queue. Both are ≥44px targets. */}
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              alignItems: 'center',
              flexWrap: 'wrap',
              mt: 2,
              pt: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              Also
            </Typography>
            <Button
              component={RouterLink}
              to={ROUTES.programs}
              variant="text"
              size="small"
              sx={{
                minHeight: 44,
                px: 1,
                fontWeight: 400,
                color: 'text.secondary',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {stats.active_programmes} programmes
            </Button>
            <Typography variant="caption" color="text.disabled" aria-hidden>
              ·
            </Typography>
            <Button
              component={RouterLink}
              to={`${ROUTES.students}?status=Graduated`}
              variant="text"
              size="small"
              sx={{
                minHeight: 44,
                px: 1,
                fontWeight: 400,
                color: 'text.secondary',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {/* "to date", not "this year": `graduation_date` is unrecorded across the
                  register, so there is no year to scope by and the label must not imply
                  one. */}
              {stats.graduates} graduates to date
            </Button>
          </Stack>
        </Panel>
      </Grid>

      {/* ── Academic outcomes: the one figure that earns a panel, beside the ranked
             table that explains it (§42 "course failure rates"). ─────────────────── */}
      <Grid item xs={12}>
        <Panel
          title="Academic outcomes"
          caption="This session, over grades that have resolved to a letter."
        >
          <Grid container spacing={{ xs: 2, md: 3 }}>
            <Grid item xs={12} md={4}>
              <ButtonBase
                component={RouterLink}
                to={ROUTES.grades}
                aria-label={`Failure rate ${failureRate}% of resolved grades — open the gradebook`}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  width: '100%',
                  p: 2,
                  ml: { xs: 0, md: -2 },
                  borderRadius: 1,
                  minHeight: 44,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography
                  variant="h2"
                  component="p"
                  sx={{ lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
                >
                  {failureRate}%
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {failureRate > 0
                    ? 'of resolved grades came back failing'
                    : 'no resolved grade came back failing'}
                </Typography>
                {/* The denominator matters enough to print: on enrolments this figure
                    would be meaningless three weeks into a session. */}
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                  Enrolments are never the denominator — only grades with a letter.
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.25}
                  sx={{ alignItems: 'center', mt: 1.5, color: 'primary.main' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Open the gradebook
                  </Typography>
                  <ChevronRightIcon aria-hidden fontSize="small" />
                </Stack>
              </ButtonBase>
            </Grid>

            <Grid item xs={12} md={8}>
              <Typography variant="subtitle1" component="h3">
                Highest failure rates
              </Typography>
              {worstCourses.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No course has enough resolved grades to be ranked yet.
                </Typography>
              ) : (
                <>
                  {/* Only courses with enough resolved grades appear — the server drops
                      the rest, because a list sorted by percentage would otherwise put a
                      course with one graded student above a course with thirty and a real
                      problem. */}
                  <Typography variant="caption" color="text.secondary" component="p">
                    Courses with at least five resolved grades, worst first.
                  </Typography>
                  <TableContainer sx={{ overflowX: 'auto', mt: 1 }}>
                    <Table size="small" aria-label="Courses by failure rate, highest first">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ color: 'text.secondary' }}>Course</TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary' }}>
                            Results
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary' }}>
                            Failing
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary' }}>
                            Rate
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {worstCourses.map((c) => (
                          <TableRow key={c.course_code} sx={{ '&:last-of-type td': { border: 0 } }}>
                            {/* Code and title share one cell so the table survives a
                                390px phone without hiding the thing being ranked. */}
                            <TableCell sx={{ maxWidth: { xs: 180, sm: 320 } }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                {c.course_code}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="span"
                                noWrap
                                sx={{ display: 'block' }}
                              >
                                {c.course_name}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ fontVariantNumeric: 'tabular-nums' }}
                              >
                                {c.results}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography
                                variant="body2"
                                sx={{ fontVariantNumeric: 'tabular-nums' }}
                              >
                                {c.failing}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ minWidth: 76 }}>
                              {/* The percentage stays in text.primary and the bar carries
                                  the red: the number is the meaning, the bar is only the
                                  rank, and nothing here depends on colour alone. */}
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                              >
                                {c.failure_rate}%
                              </Typography>
                              <Box
                                aria-hidden
                                sx={{
                                  mt: 0.5,
                                  height: 3,
                                  borderRadius: 999,
                                  bgcolor: 'divider',
                                  overflow: 'hidden',
                                }}
                              >
                                <Box
                                  sx={(theme) => ({
                                    height: '100%',
                                    width: `${Math.max(0, Math.min(100, c.failure_rate))}%`,
                                    bgcolor: alpha(theme.palette.error.main, 0.6),
                                  })}
                                />
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </Grid>
          </Grid>
        </Panel>
      </Grid>

      {/* ── Analytics. `ChartWithTable` stays: it is the accessible chart+table pattern
             the design system mandates (§9.5). ──────────────────────────────────── */}
      {charts.map((c) => (
        <Grid item xs={12} lg={chartSpan} key={c.key}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <ChartWithTable
                title={c.title}
                type={c.type}
                data={c.data}
                categoryLabel={c.categoryLabel}
                valueLabel="Students"
              />
            </CardContent>
          </Card>
        </Grid>
      ))}

      {/* ── Reference lists. Last, because nothing here is a task. ───────────────── */}
      {lists.map((l) => (
        <Grid item xs={12} md={lists.length === 1 ? 12 : 6} lg={listSpan} key={l.key}>
          {l.node}
        </Grid>
      ))}
    </Grid>
  );
}

export default AdminDashboard;
