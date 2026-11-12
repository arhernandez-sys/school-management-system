import { Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useClassroomOptions } from '@features/classrooms/hooks/useClassrooms';
import { DAY_LONG, meetingRowInvalid, WEEKDAYS } from '../meetingFormat';
import type { DayOfWeek, OfferingMeetingInput } from '../types';

/**
 * The weekly-schedule editor: a plain list of Day · Start · End · Room rows.
 *
 * Deliberately NOT a calendar. Scheduling a college course is entering four values a
 * handful of times, and a drag-and-drop grid would add a large interaction surface (and a
 * touch-accessibility problem) to a task that four native inputs already do — with the
 * keyboard, on a phone, and with a screen reader. Native `<input type="time">` also gives
 * the platform's own time picker and locale for free.
 *
 * Validation here is only what the inputs can enforce locally (end after start). Every
 * cross-offering rule — lecturer double-booked, room double-booked, student clash — is the
 * server's, because only the server can see the other offerings; it reports those as
 * warnings rather than rejections, so this component never blocks a save on them.
 *
 * Room is per ROW because one course legitimately meets in a lecture room on Monday and a
 * lab on Wednesday. It is a DROPDOWN of the college's active classrooms (Nov 2026), not
 * free text, and a new row starts in the offering's own classroom (`defaultRoom`).
 */
export interface MeetingRowsEditorProps {
  value: OfferingMeetingInput[];
  onChange: (next: OfferingMeetingInput[]) => void;
  disabled?: boolean;
  /** Compact spacing for use inside the create dialog. */
  dense?: boolean;
  /** Room label pre-filled on a newly added meeting — the offering's own classroom. */
  defaultRoom?: string | null;
}

/** A sensible new row: Monday morning, which is what most first meetings are. */
const NEW_ROW: OfferingMeetingInput = {
  day_of_week: 1,
  start_time: '08:00',
  end_time: '09:00',
  room: '',
};

export function MeetingRowsEditor({
  value,
  onChange,
  disabled = false,
  dense = false,
  defaultRoom = null,
}: MeetingRowsEditorProps) {
  // The same ACTIVE-room list the offering's Classroom dropdown uses (shared query key,
  // so it is fetched once). The meeting stores the room's server-built `label` as text:
  // `class_meetings.room` is still a free-text column.
  const classroomsQuery = useClassroomOptions();
  const roomOptions = classroomsQuery.data?.items ?? [];
  const roomLabels = new Set(roomOptions.map((r) => r.label));

  const update = (index: number, patch: Partial<OfferingMeetingInput>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <Stack spacing={dense ? 1.5 : 2}>
      {value.map((row, index) => {
        const invalid = meetingRowInvalid(row);
        return (
          <Stack
            key={index}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'flex-start' }}
          >
            <TextField
              select
              size="small"
              label="Day"
              value={row.day_of_week}
              onChange={(e) =>
                update(index, { day_of_week: Number(e.target.value) as DayOfWeek })
              }
              disabled={disabled}
              sx={{ minWidth: 130 }}
            >
              {WEEKDAYS.map((d) => (
                <MenuItem key={d} value={d}>
                  {DAY_LONG[d]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="time"
              label="Start"
              value={row.start_time}
              onChange={(e) => update(index, { start_time: e.target.value })}
              disabled={disabled}
              // Native time inputs need a persistent label — the value is never "empty"
              // enough for the floating label to sit inside the field.
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 120 }}
            />
            <TextField
              size="small"
              type="time"
              label="End"
              value={row.end_time}
              onChange={(e) => update(index, { end_time: e.target.value })}
              disabled={disabled}
              InputLabelProps={{ shrink: true }}
              error={invalid}
              helperText={invalid ? 'Must be after the start time.' : undefined}
              sx={{ minWidth: 120 }}
            />
            <TextField
              select
              size="small"
              label="Room"
              value={row.room ?? ''}
              onChange={(e) => update(index, { room: e.target.value })}
              disabled={disabled}
              helperText={classroomsQuery.isLoading ? 'Loading rooms…' : undefined}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
              fullWidth
            >
              <MenuItem value="">
                <em>No room</em>
              </MenuItem>
              {/* A value typed before this was a dropdown (or a room since retired) stays
                  selectable, so opening and re-saving a schedule never silently drops it. */}
              {row.room && !roomLabels.has(row.room) && (
                <MenuItem value={row.room}>{row.room} (not in classroom list)</MenuItem>
              )}
              {roomOptions.map((room) => (
                <MenuItem key={room.id} value={room.label}>
                  {room.label}
                  {room.capacity > 0 ? ` · ${room.capacity} seats` : ''}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', alignItems: 'center', pt: { xs: 0, sm: 0.25 } }}>
              <Tooltip title="Remove this meeting">
                <IconButton
                  aria-label={`Remove ${DAY_LONG[row.day_of_week]} meeting`}
                  onClick={() => remove(index)}
                  disabled={disabled}
                  size="small"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Stack>
        );
      })}

      <Box>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => onChange([...value, { ...NEW_ROW, room: defaultRoom ?? '' }])}
          disabled={disabled}
        >
          Add meeting
        </Button>
      </Box>
    </Stack>
  );
}

export default MeetingRowsEditor;
