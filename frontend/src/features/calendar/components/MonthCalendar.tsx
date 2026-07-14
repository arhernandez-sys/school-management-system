import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import {
  CATEGORY_META,
  WEEKDAY_LABELS,
  eventsOnDay,
  formatTime,
  monthMatrix,
} from '../utils';
import type { CalendarEvent } from '../types';

export interface MonthCalendarProps {
  year: number;
  monthIndex: number;
  events: CalendarEvent[];
  /** Server "today" — highlighted in the grid. */
  referenceDate: string;
  canManage: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  /** Manager-only: clicking an empty part of a day starts a new event on it. */
  onAddOnDay: (ymd: string) => void;
}

const MAX_CHIPS = 3;

/**
 * Month grid (Sunday-first, 6 weeks). Each day shows up to three event chips colour-coded
 * by category; a chip opens the event, and — for principal/secretary — clicking the empty
 * area of a day starts a new event on that date. Scrolls horizontally on narrow screens.
 */
export function MonthCalendar({
  year,
  monthIndex,
  events,
  referenceDate,
  canManage,
  onSelectEvent,
  onAddOnDay,
}: MonthCalendarProps) {
  const cells = monthMatrix(year, monthIndex);

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ minWidth: 700 }}>
        {/* Weekday header */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {WEEKDAY_LABELS.map((label) => (
            <Typography
              key={label}
              variant="caption"
              sx={{ px: 1, py: 0.75, fontWeight: 600, color: 'text.secondary' }}
            >
              {label}
            </Typography>
          ))}
        </Box>

        {/* Day cells */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gridAutoRows: 'minmax(104px, auto)',
          }}
        >
          {cells.map((cell) => {
            const dayEvents = eventsOnDay(events, cell.ymd);
            const isToday = cell.ymd === referenceDate;
            const shown = dayEvents.slice(0, MAX_CHIPS);
            const overflow = dayEvents.length - shown.length;

            return (
              <Box
                key={cell.ymd}
                sx={{
                  borderRight: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: cell.inMonth ? 'background.paper' : 'action.hover',
                  p: 0.5,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                }}
              >
                {/* Day number (click empty space to add, managers only) */}
                <ButtonBase
                  focusRipple={canManage}
                  disabled={!canManage}
                  onClick={canManage ? () => onAddOnDay(cell.ymd) : undefined}
                  aria-label={canManage ? `Add event on ${cell.ymd}` : undefined}
                  sx={{
                    alignSelf: 'flex-start',
                    borderRadius: '50%',
                    width: 26,
                    height: 26,
                    mb: 0.25,
                    cursor: canManage ? 'pointer' : 'default',
                  }}
                >
                  <Box
                    sx={{
                      width: 24,
                      height: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      bgcolor: isToday ? 'primary.main' : 'transparent',
                      color: isToday
                        ? 'primary.contrastText'
                        : cell.inMonth
                          ? 'text.primary'
                          : 'text.disabled',
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: isToday ? 700 : 400 }}>
                      {cell.day}
                    </Typography>
                  </Box>
                </ButtonBase>

                {/* Event chips */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                  {shown.map((e) => {
                    const meta = CATEGORY_META[e.category];
                    return (
                      <Tooltip
                        key={e.id}
                        title={e.visibility === 'internal' ? `${e.title} · Staff only` : e.title}
                        enterDelay={400}
                      >
                        <ButtonBase
                          onClick={() => onSelectEvent(e)}
                          sx={{
                            justifyContent: 'flex-start',
                            textAlign: 'left',
                            borderRadius: 0.5,
                            px: 0.5,
                            py: 0.125,
                            gap: 0.25,
                            width: '100%',
                            bgcolor: `${meta.color}.main`,
                            color: `${meta.color}.contrastText`,
                            '&:hover': { filter: 'brightness(0.92)' },
                          }}
                        >
                          {e.visibility === 'internal' && (
                            <LockOutlinedIcon sx={{ fontSize: 12, flexShrink: 0 }} aria-hidden />
                          )}
                          <Typography
                            variant="caption"
                            noWrap
                            sx={{ fontWeight: 500, lineHeight: 1.4, minWidth: 0 }}
                          >
                            {!e.all_day && e.start_time ? `${formatTime(e.start_time)} ` : ''}
                            {e.title}
                          </Typography>
                        </ButtonBase>
                      </Tooltip>
                    );
                  })}
                  {overflow > 0 && (
                    <Typography variant="caption" sx={{ px: 0.5, color: 'text.secondary' }}>
                      +{overflow} more
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

export default MonthCalendar;
