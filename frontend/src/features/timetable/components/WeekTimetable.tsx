import { Box, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { formatTimeRange } from '@features/offerings/meetingFormat';
import type { TimetableDay, TimetableEntry } from '../types';

/**
 * The Mon–Fri week, shared by the student and teacher timetables.
 *
 * Two layouts, one component, following the responsive convention `DataTable` already
 * established (table on desktop, cards on mobile):
 *  - **Desktop**: five columns side by side — the shape people picture when they say
 *    "timetable", and the only way to see the whole week at once.
 *  - **Mobile**: day-grouped vertical list. Five columns on a phone would each be ~70px
 *    wide, which cannot hold a course name, so it degrades to sections rather than
 *    horizontal scroll.
 *
 * Deliberately NOT time-proportional: blocks are laid out in start order, not positioned
 * against a clock axis. A proportional grid needs a fixed day window and gives every gap
 * empty vertical space, and nothing here depends on seeing that a gap is 25 minutes rather
 * than 40 — the times are printed on every card.
 *
 * `showTeacher` is off for a lecturer's own week, where every row would repeat their name.
 */
export interface WeekTimetableProps {
  days: TimetableDay[];
  showTeacher?: boolean;
  /** Rendered in a day column/section with nothing on it. */
  emptyDayLabel?: string;
}

function EntryCard({ entry, showTeacher }: { entry: TimetableEntry; showTeacher: boolean }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
        borderLeftColor: 'primary.main',
      }}
    >
      <Stack spacing={0.5}>
        <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>
          {entry.offering.course.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatTimeRange(entry.start_time, entry.end_time)}
        </Typography>
        {/* The offering label carries code + section, which is what distinguishes one
            section of a course from the other — so it is never omitted. */}
        <Typography variant="caption" color="text.secondary">
          {entry.offering.label}
        </Typography>
        {entry.room && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <RoomOutlinedIcon sx={{ fontSize: 14 }} color="action" />
            <Typography variant="caption">{entry.room}</Typography>
          </Stack>
        )}
        {showTeacher && entry.teachers.length > 0 && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <PersonOutlineIcon sx={{ fontSize: 14 }} color="action" />
            <Typography variant="caption" color="text.secondary">
              {entry.teachers.map((t) => t.full_name).join(', ')}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

export function WeekTimetable({
  days,
  showTeacher = true,
  emptyDayLabel = 'Nothing scheduled',
}: WeekTimetableProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  if (isMobile) {
    return (
      <Stack spacing={2}>
        {days.map((day) => (
          <Box key={day.day_of_week} component="section" aria-labelledby={`day-${day.day_of_week}`}>
            <Typography
              id={`day-${day.day_of_week}`}
              variant="subtitle2"
              sx={{ mb: 1, color: 'text.secondary' }}
            >
              {day.day_name}
            </Typography>
            {day.entries.length === 0 ? (
              <Typography variant="body2" color="text.disabled">
                {emptyDayLabel}
              </Typography>
            ) : (
              <Stack spacing={1}>
                {day.entries.map((e) => (
                  <EntryCard key={e.meeting_id} entry={e} showTeacher={showTeacher} />
                ))}
              </Stack>
            )}
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        // Equal columns so the week reads as a grid; `minmax(0, 1fr)` keeps a long class
        // name from widening its own column past its share.
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        gap: 1.5,
        alignItems: 'start',
      }}
    >
      {days.map((day) => (
        <Stack key={day.day_of_week} spacing={1}>
          <Typography
            variant="subtitle2"
            sx={{
              color: 'text.secondary',
              pb: 0.5,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            {day.day_name}
          </Typography>
          {day.entries.length === 0 ? (
            <Typography variant="caption" color="text.disabled">
              {emptyDayLabel}
            </Typography>
          ) : (
            day.entries.map((e) => (
              <EntryCard key={e.meeting_id} entry={e} showTeacher={showTeacher} />
            ))
          )}
        </Stack>
      ))}
    </Box>
  );
}

export default WeekTimetable;
