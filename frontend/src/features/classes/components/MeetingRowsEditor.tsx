import { Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { DAY_LONG, meetingRowInvalid, WEEKDAYS } from '../meetingFormat';
import type { ClassMeetingInput, DayOfWeek } from '../types';

/**
 * The weekly-schedule editor: a plain list of Day · Start · End · Room rows.
 *
 * Deliberately NOT a calendar. Scheduling a sixth-form class is entering four values a
 * handful of times, and a drag-and-drop grid would add a large interaction surface (and a
 * touch-accessibility problem) to a task that four native inputs already do — with the
 * keyboard, on a phone, and with a screen reader. Native `<input type="time">` also gives
 * the platform's own time picker and locale for free.
 *
 * Validation here is only what the inputs can enforce locally (end after start). Every
 * cross-class rule — teacher double-booked, room double-booked, student clash — is the
 * server's, because only the server can see the other classes; it reports those as
 * warnings rather than rejections, so this component never blocks a save on them.
 */
export interface MeetingRowsEditorProps {
  value: ClassMeetingInput[];
  onChange: (next: ClassMeetingInput[]) => void;
  disabled?: boolean;
  /** Compact spacing for use inside the create dialog. */
  dense?: boolean;
}

/** A sensible new row: Monday morning, which is what most first meetings are. */
const NEW_ROW: ClassMeetingInput = {
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
}: MeetingRowsEditorProps) {
  const update = (index: number, patch: Partial<ClassMeetingInput>) => {
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
              size="small"
              label="Room"
              value={row.room ?? ''}
              onChange={(e) => update(index, { room: e.target.value })}
              disabled={disabled}
              placeholder="Room A"
              fullWidth
            />
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
          onClick={() => onChange([...value, { ...NEW_ROW }])}
          disabled={disabled}
        >
          Add meeting
        </Button>
      </Box>
    </Stack>
  );
}

export default MeetingRowsEditor;
