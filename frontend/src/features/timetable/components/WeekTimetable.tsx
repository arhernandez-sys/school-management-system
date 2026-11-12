import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { alpha, Box, Button, Chip, Paper, Stack, Typography, useTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EventIcon from '@mui/icons-material/EventOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBookOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import { ROUTES } from '@shared/constants/routes';
import { schoolNow } from '@shared/utils/schoolDate';
import { DAY_SHORT, formatTimeRange } from '@features/offerings/meetingFormat';
import type { TimetableDay, TimetableEntry } from '../types';

/**
 * The Mon–Fri week for "My Timetable" — same visual language as an offering's Schedule tab
 * (`WeeklyScheduleView`): summary chips, a "Next class" panel, and a day grid with today
 * highlighted.
 *
 *  - **Summary**: classes a week, contact hours, number of courses.
 *  - **Next class** (only when `live`): the next class from now in school time
 *    (America/Belize). For a lecturer (`canTakeAttendance`), each of today's classes gets a
 *    "Take attendance" button that opens that exact session's register — attendance is per
 *    scheduled session, so the link carries `start_time`.
 *  - **Grid**: five columns on desktop, stacked day rows on phones. Each course keeps one
 *    accent colour all week so "the Biology blocks" can be spotted without reading.
 *
 * `live` is false when viewing a past year: "today" and "next class" would describe a week
 * that is not this one, so they are hidden.
 *
 * Deliberately NOT time-proportional: blocks are laid out in start order with times printed
 * on each, which reads better than mostly-empty clock-axis columns.
 */
export interface WeekTimetableProps {
  days: TimetableDay[];
  /** Off for a lecturer's own week, where every block would repeat their name. */
  showTeacher?: boolean;
  /** Shown in a day with nothing on it. */
  emptyDayLabel?: string;
  /** The week is the current one: show "today" and "next class". */
  live?: boolean;
  /** Lecturer's own week: today's classes get "Take attendance". */
  canTakeAttendance?: boolean;
}

type Accent = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
const ACCENTS: Accent[] = ['primary', 'info', 'success', 'secondary', 'warning', 'error'];

const hhmm = (t: string) => t.slice(0, 5);

function minutes(t: string): number {
  const [h = '0', m = '0'] = t.split(':');
  return Number(h) * 60 + Number(m);
}

function formatDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function accentColor(theme: Theme, accent: Accent): string {
  return theme.palette[accent].main;
}

function EntryBlock({
  entry,
  color,
  showTeacher,
  emphasized,
}: {
  entry: TimetableEntry;
  color: string;
  showTeacher: boolean;
  emphasized: boolean;
}) {
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 1,
        borderLeft: 3,
        borderLeftColor: color,
        bgcolor: alpha(color, emphasized ? 0.16 : 0.07),
        minWidth: 0,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {formatTimeRange(entry.start_time, entry.end_time)}
      </Typography>
      <Typography variant="body2" sx={{ lineHeight: 1.3, mt: 0.25 }}>
        {entry.offering.course.name}
      </Typography>
      {/* The label carries code + section — what tells two sections of a course apart. */}
      <Typography variant="caption" color="text.secondary" component="p">
        {entry.offering.label} ·{' '}
        {formatDuration(minutes(entry.end_time) - minutes(entry.start_time))}
      </Typography>
      {entry.room && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
          <RoomOutlinedIcon sx={{ fontSize: 14 }} color="action" />
          <Typography variant="caption" noWrap>
            {entry.room}
          </Typography>
        </Stack>
      )}
      {showTeacher && entry.teachers.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
          <PersonOutlineIcon sx={{ fontSize: 14 }} color="action" />
          <Typography variant="caption" color="text.secondary" noWrap>
            {entry.teachers.map((t) => t.full_name).join(', ')}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

export function WeekTimetable({
  days,
  showTeacher = true,
  emptyDayLabel = 'No class',
  live = true,
  canTakeAttendance = false,
}: WeekTimetableProps) {
  const theme = useTheme();
  const now = schoolNow();

  const all = useMemo(() => days.flatMap((d) => d.entries), [days]);

  // One stable accent per offering, in first-seen (Mon → Fri, by time) order.
  const accentOf = useMemo(() => {
    const map = new Map<string, Accent>();
    for (const e of all) {
      if (!map.has(e.offering.id)) map.set(e.offering.id, ACCENTS[map.size % ACCENTS.length]!);
    }
    return (offeringId: string) => accentColor(theme, map.get(offeringId) ?? 'primary');
  }, [all, theme]);

  const weeklyMinutes = all.reduce(
    (sum, e) => sum + Math.max(0, minutes(e.end_time) - minutes(e.start_time)),
    0,
  );
  const courseCount = new Set(all.map((e) => e.offering.id)).size;

  const sortedDay = (d: TimetableDay) =>
    [...d.entries].sort((a, b) => a.start_time.localeCompare(b.start_time));

  const today = useMemo(() => {
    if (!live) return [];
    const d = days.find((x) => x.day_of_week === now.isoWeekday);
    return d ? sortedDay(d) : [];
  }, [days, live, now.isoWeekday]);

  const inProgress = (e: TimetableEntry) =>
    hhmm(e.start_time) <= now.time && now.time < hhmm(e.end_time);

  const next = useMemo(() => {
    if (!live) return null;
    const later = today.find((e) => hhmm(e.end_time) > now.time);
    if (later) return { entry: later, dayLabel: 'Today' };
    for (let offset = 1; offset <= 7; offset += 1) {
      const dow = ((now.isoWeekday - 1 + offset) % 7) + 1;
      const d = days.find((x) => x.day_of_week === dow);
      const first = d ? sortedDay(d)[0] : undefined;
      if (d && first) return { entry: first, dayLabel: offset === 1 ? 'Tomorrow' : d.day_name };
    }
    return null;
  }, [live, today, days, now.isoWeekday, now.time]);

  const registerHref = (e: TimetableEntry) =>
    `${ROUTES.attendance}/record?${new URLSearchParams({
      offering_id: e.offering.id,
      date: now.date,
      start_time: hhmm(e.start_time),
    }).toString()}`;

  const showAttendance = live && canTakeAttendance && today.length > 0;

  return (
    <Stack spacing={2.5}>
      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip
          icon={<EventIcon />}
          variant="outlined"
          label={`${all.length} ${all.length === 1 ? 'class' : 'classes'} a week`}
        />
        <Chip
          icon={<AccessTimeIcon />}
          variant="outlined"
          label={`${formatDuration(weeklyMinutes)} per week`}
        />
        <Chip
          icon={<MenuBookIcon />}
          variant="outlined"
          label={`${courseCount} ${courseCount === 1 ? 'course' : 'courses'}`}
        />
      </Stack>

      {/* ── Next class / today ──────────────────────────────────────────────── */}
      {(next || showAttendance) && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderColor: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
          }}
        >
          {next && (
            <Box sx={{ mb: showAttendance ? 1.5 : 0 }}>
              <Typography variant="overline" color="primary" sx={{ lineHeight: 1.6 }}>
                {next.dayLabel === 'Today' && inProgress(next.entry) ? 'In class now' : 'Next class'}
              </Typography>
              <Typography variant="h6" component="p" sx={{ lineHeight: 1.3 }}>
                {next.entry.offering.course.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {next.dayLabel} · {formatTimeRange(next.entry.start_time, next.entry.end_time)}
                {next.entry.room ? ` · ${next.entry.room}` : ''} · {next.entry.offering.label}
              </Typography>
            </Box>
          )}

          {showAttendance && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Today's {today.length === 1 ? 'class' : 'classes'} — take attendance for each one.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {today.map((e) => (
                  <Button
                    key={e.meeting_id}
                    component={RouterLink}
                    to={registerHref(e)}
                    variant={inProgress(e) ? 'contained' : 'outlined'}
                    startIcon={<FactCheckIcon />}
                    sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {e.offering.label} · {formatTimeRange(e.start_time, e.end_time)}
                  </Button>
                ))}
              </Stack>
            </Stack>
          )}
        </Paper>
      )}

      {/* ── Week grid ───────────────────────────────────────────────────────── */}
      <Box
        role="list"
        aria-label="Weekly timetable"
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', md: `repeat(${days.length}, minmax(0, 1fr))` },
        }}
      >
        {days.map((day) => {
          const items = sortedDay(day);
          const isToday = live && day.day_of_week === now.isoWeekday;
          return (
            <Paper
              key={day.day_of_week}
              role="listitem"
              aria-label={day.day_name}
              variant="outlined"
              sx={{
                p: 1.5,
                display: 'flex',
                flexDirection: { xs: 'row', md: 'column' },
                gap: 1.25,
                alignItems: { xs: 'flex-start', md: 'stretch' },
                minHeight: { md: 160 },
                borderColor: isToday ? 'primary.main' : undefined,
                borderWidth: isToday ? 2 : 1,
                bgcolor: items.length === 0 ? 'action.hover' : 'background.paper',
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', minWidth: { xs: 96, md: 0 } }}
              >
                <Typography variant="subtitle2" color={isToday ? 'primary' : 'text.primary'}>
                  <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>
                    {DAY_SHORT[day.day_of_week]}
                  </Box>
                  <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                    {day.day_name}
                  </Box>
                </Typography>
                {isToday && <Chip size="small" color="primary" label="Today" />}
              </Stack>

              <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                {items.length === 0 ? (
                  <Typography variant="body2" color="text.disabled">
                    {emptyDayLabel}
                  </Typography>
                ) : (
                  items.map((e) => (
                    <EntryBlock
                      key={e.meeting_id}
                      entry={e}
                      color={accentOf(e.offering.id)}
                      showTeacher={showTeacher}
                      emphasized={isToday && inProgress(e)}
                    />
                  ))
                )}
              </Stack>
            </Paper>
          );
        })}
      </Box>
    </Stack>
  );
}

export default WeekTimetable;
