import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { alpha, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EventIcon from '@mui/icons-material/EventOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import { ROUTES } from '@shared/constants/routes';
import { schoolNow } from '@shared/utils/schoolDate';
import { DAY_LONG, DAY_SHORT, formatTimeRange, WEEKDAYS } from '../meetingFormat';
import type { DayOfWeek, OfferingMeetingInput } from '../types';

/**
 * Read-only week view of ONE offering's schedule — what a lecturer (or student) sees on
 * the Schedule tab. Replaces a flat list of text cards.
 *
 *  1. A one-line summary: classes per week, contact hours, rooms.
 *  2. A "Next class" panel. For the offering's own lecturer, each of TODAY's classes gets a
 *     "Take attendance" button that opens that exact session's register — attendance is
 *     per scheduled session, so the button carries `start_time`.
 *  3. A Mon–Fri grid (stacked on phones) with today's column highlighted, so the shape of
 *     the week reads at a glance.
 *
 * Times are compared as school-local `HH:MM` strings (America/Belize), never the device
 * clock, matching how the server decides what "today" is.
 */
export interface WeeklyScheduleViewProps {
  offeringId: string;
  /** Rows in `HH:MM` form (the Schedule tab's draft shape). */
  meetings: OfferingMeetingInput[];
  /** Show "Take attendance" on today's classes — the offering's own lecturer only. */
  canTakeAttendance?: boolean;
}

function minutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function formatDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function WeeklyScheduleView({
  offeringId,
  meetings,
  canTakeAttendance = false,
}: WeeklyScheduleViewProps) {
  const now = schoolNow();

  const sorted = useMemo(
    () =>
      [...meetings].sort(
        (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
      ),
    [meetings],
  );

  const byDay = useMemo(() => {
    const map = new Map<DayOfWeek, OfferingMeetingInput[]>();
    for (const d of WEEKDAYS) map.set(d, []);
    for (const m of sorted) map.get(m.day_of_week)?.push(m);
    return map;
  }, [sorted]);

  const weeklyMinutes = sorted.reduce(
    (sum, m) => sum + Math.max(0, minutes(m.end_time) - minutes(m.start_time)),
    0,
  );
  const rooms = [...new Set(sorted.map((m) => m.room?.trim()).filter(Boolean))] as string[];

  const today = useMemo(
    () => (now.isoWeekday <= 5 ? (byDay.get(now.isoWeekday as DayOfWeek) ?? []) : []),
    [byDay, now.isoWeekday],
  );

  // The next class from now: later today, else the first one on a following weekday,
  // wrapping into next week.
  const next = useMemo(() => {
    const later = today.find((m) => m.end_time > now.time);
    if (later) return { meeting: later, isToday: true };
    for (let offset = 1; offset <= 7; offset += 1) {
      const dow = ((now.isoWeekday - 1 + offset) % 7) + 1;
      if (dow > 5) continue;
      const first = byDay.get(dow as DayOfWeek)?.[0];
      if (first) return { meeting: first, isToday: false };
    }
    return null;
  }, [today, byDay, now.isoWeekday, now.time]);

  const inProgress = (m: OfferingMeetingInput) =>
    m.start_time <= now.time && now.time < m.end_time;

  const registerHref = (m: OfferingMeetingInput) =>
    `${ROUTES.attendance}/record?${new URLSearchParams({
      offering_id: offeringId,
      date: now.date,
      start_time: m.start_time,
    }).toString()}`;

  return (
    <Stack spacing={2.5}>
      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip
          icon={<EventIcon />}
          variant="outlined"
          label={`${sorted.length} ${sorted.length === 1 ? 'class' : 'classes'} a week`}
        />
        <Chip
          icon={<AccessTimeIcon />}
          variant="outlined"
          label={`${formatDuration(weeklyMinutes)} per week`}
        />
        {rooms.map((r) => (
          <Chip key={r} icon={<RoomOutlinedIcon />} variant="outlined" label={r} />
        ))}
      </Stack>

      {/* ── Next class / today ──────────────────────────────────────────────── */}
      {(next || today.length > 0) && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderColor: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
          }}
        >
          {next && (
            <Box sx={{ mb: canTakeAttendance && today.length > 0 ? 1.5 : 0 }}>
              <Typography variant="overline" color="primary" sx={{ lineHeight: 1.6 }}>
                {next.isToday && inProgress(next.meeting) ? 'In class now' : 'Next class'}
              </Typography>
              <Typography variant="h6" component="p" sx={{ lineHeight: 1.3 }}>
                {next.isToday ? 'Today' : DAY_LONG[next.meeting.day_of_week]} ·{' '}
                {formatTimeRange(next.meeting.start_time, next.meeting.end_time)}
              </Typography>
              {next.meeting.room && (
                <Typography variant="body2" color="text.secondary">
                  {next.meeting.room}
                </Typography>
              )}
            </Box>
          )}

          {canTakeAttendance && today.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Today's {today.length === 1 ? 'class' : 'classes'} — attendance is taken for
                each one.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {today.map((m) => (
                  <Button
                    key={m.start_time}
                    component={RouterLink}
                    to={registerHref(m)}
                    variant={inProgress(m) ? 'contained' : 'outlined'}
                    startIcon={<FactCheckIcon />}
                    sx={{ textTransform: 'none' }}
                  >
                    Take attendance · {formatTimeRange(m.start_time, m.end_time)}
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
        aria-label="Weekly schedule"
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' },
        }}
      >
        {WEEKDAYS.map((d) => {
          const items = byDay.get(d) ?? [];
          const isToday = d === now.isoWeekday;
          return (
            <Paper
              key={d}
              role="listitem"
              variant="outlined"
              sx={{
                p: 1.5,
                display: 'flex',
                flexDirection: { xs: 'row', md: 'column' },
                gap: 1.25,
                alignItems: { xs: 'flex-start', md: 'stretch' },
                minHeight: { md: 140 },
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
                    {DAY_SHORT[d]}
                  </Box>
                  <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                    {DAY_LONG[d]}
                  </Box>
                </Typography>
                {isToday && <Chip size="small" color="primary" label="Today" />}
              </Stack>

              <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                {items.length === 0 ? (
                  <Typography variant="body2" color="text.disabled">
                    No class
                  </Typography>
                ) : (
                  items.map((m) => (
                    <Box
                      key={`${m.start_time}-${m.end_time}`}
                      sx={{
                        p: 1,
                        borderRadius: 1,
                        borderLeft: 3,
                        borderColor: 'primary.main',
                        bgcolor: (t) =>
                          alpha(t.palette.primary.main, isToday && inProgress(m) ? 0.14 : 0.06),
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatTimeRange(m.start_time, m.end_time)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="p">
                        {formatDuration(minutes(m.end_time) - minutes(m.start_time))}
                      </Typography>
                      {m.room && (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
                          <RoomOutlinedIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" noWrap>
                            {m.room}
                          </Typography>
                        </Stack>
                      )}
                    </Box>
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

export default WeeklyScheduleView;
