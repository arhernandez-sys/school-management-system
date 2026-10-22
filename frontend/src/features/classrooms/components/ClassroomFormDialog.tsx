import { useEffect, useState } from 'react';
import { Alert, MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import {
  CLASSROOM_STATUS_LABEL,
  SETTABLE_CLASSROOM_STATUSES,
  type ClassroomListItem,
  type ClassroomStatus,
  type ClassroomWritePayload,
} from '../types';

export interface ClassroomFormDialogProps {
  open: boolean;
  /** The room being edited, or null/undefined to create one. */
  classroom?: ClassroomListItem | null;
  submitting?: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: ClassroomWritePayload) => void;
  onClose: () => void;
}

/**
 * Create / edit a room (D44).
 *
 * ⚠️ THE STATUS SELECT OFFERS TWO VALUES, NOT FIVE. The column can hold `In-Use`,
 * `Available` and `Occupied` because the client's own dump does, but those describe live
 * OCCUPANCY — a fact the timetable derives and that is wrong within the hour if a person
 * types it. The server refuses them with `classroom_status_not_settable`; offering them
 * here would be offering a control that fails.
 */
export function ClassroomFormDialog({
  open,
  classroom,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: ClassroomFormDialogProps) {
  const editing = Boolean(classroom);
  const [roomCode, setRoomCode] = useState('');
  const [building, setBuilding] = useState('');
  const [capacity, setCapacity] = useState('');
  const [roomType, setRoomType] = useState('');
  const [status, setStatus] = useState<ClassroomStatus>('Active');

  useEffect(() => {
    if (open) {
      setRoomCode(classroom?.room_code ?? '');
      setBuilding(classroom?.building ?? '');
      setCapacity(classroom?.capacity ? String(classroom.capacity) : '');
      setRoomType(classroom?.room_type ?? '');
      // An existing room may be sitting on one of the three occupancy values (the client's
      // data does). Editing it must not silently rewrite that to Active, so the current
      // value is kept in state and the select simply shows it as an extra option.
      setStatus(classroom?.status ?? 'Active');
    }
  }, [open, classroom]);

  const capacityNumber = capacity.trim() === '' ? 0 : Number(capacity);
  const capacityValid = Number.isInteger(capacityNumber) && capacityNumber >= 0;
  const unsettable = !SETTABLE_CLASSROOM_STATUSES.includes(status);

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit classroom' : 'Add classroom'}
      submitLabel={editing ? 'Save changes' : 'Create classroom'}
      submitting={submitting}
      submitDisabled={
        roomCode.trim().length === 0 || building.trim().length === 0 || !capacityValid
      }
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          room_code: roomCode.trim(),
          building: building.trim(),
          capacity: capacityNumber,
          room_type: roomType.trim() || null,
          // Only sent when it is a value the server will accept — see the class docstring.
          ...(unsettable ? {} : { status }),
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            required
            fullWidth
            autoFocus
            inputProps={{ maxLength: 25, 'aria-required': true }}
            error={Boolean(fieldErrors?.room_code)}
            helperText={
              fieldErrors?.room_code?.join(' ') ?? 'e.g. A-101 — what a timetable shows.'
            }
          />
          <TextField
            label="Building"
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            required
            fullWidth
            inputProps={{ maxLength: 60, 'aria-required': true }}
            error={Boolean(fieldErrors?.building)}
            helperText={fieldErrors?.building?.join(' ')}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Capacity"
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            fullWidth
            inputProps={{ min: 0 }}
            error={Boolean(fieldErrors?.capacity) || !capacityValid}
            helperText={
              fieldErrors?.capacity?.join(' ') ?? 'Seats. Leave blank if it is not recorded.'
            }
          />
          <TextField
            label="Room type"
            value={roomType}
            onChange={(e) => setRoomType(e.target.value)}
            fullWidth
            inputProps={{ maxLength: 150 }}
            error={Boolean(fieldErrors?.room_type)}
            helperText={
              fieldErrors?.room_type?.join(' ') ?? 'Free text — Lecture, Lab, Computer lab.'
            }
          />
        </Stack>
        <TextField
          select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ClassroomStatus)}
          fullWidth
          error={Boolean(fieldErrors?.status)}
          helperText={
            fieldErrors?.status?.join(' ') ??
            'Inactive takes the room out of service without deleting it.'
          }
        >
          {SETTABLE_CLASSROOM_STATUSES.map((value) => (
            <MenuItem key={value} value={value}>
              {CLASSROOM_STATUS_LABEL[value]}
            </MenuItem>
          ))}
          {/* Only rendered when the record already holds one, so the select can display
              the current value instead of appearing to have silently changed it. */}
          {unsettable && (
            <MenuItem value={status} disabled>
              {CLASSROOM_STATUS_LABEL[status]} (from the imported data)
            </MenuItem>
          )}
        </TextField>
        {unsettable && (
          <Alert severity="info">
            This room carries <strong>{CLASSROOM_STATUS_LABEL[status]}</strong>, an occupancy
            value from the imported data. Occupancy comes from the timetable rather than
            being entered, so saving will leave it as it is — pick Active or Inactive to
            change it.
          </Alert>
        )}
      </Stack>
    </FormDialog>
  );
}

export default ClassroomFormDialog;
