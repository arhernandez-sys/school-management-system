import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { StatusBadge } from '@shared/components';
import { CATEGORY_META, VISIBILITY_META, formatEventWhen } from '../utils';
import type { CalendarEvent } from '../types';

export interface EventDetailDialogProps {
  open: boolean;
  event: CalendarEvent | null;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Read view of a single event. Principal/secretary also get Edit + Delete. */
export function EventDetailDialog({
  open,
  event,
  canManage,
  onEdit,
  onDelete,
  onClose,
}: EventDetailDialogProps) {
  if (!event) return null;
  const meta = CATEGORY_META[event.category];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge label={meta.label} kind={meta.kind} />
            {event.visibility === 'internal' && (
              <StatusBadge label={VISIBILITY_META.internal.label} kind="neutral" />
            )}
          </Stack>
          <Typography variant="h6" component="span">
            {event.title}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ScheduleIcon fontSize="small" color="action" />
            <Typography variant="body2">{formatEventWhen(event)}</Typography>
          </Stack>

          {event.location && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <PlaceOutlinedIcon fontSize="small" color="action" />
              <Typography variant="body2">{event.location}</Typography>
            </Stack>
          )}

          {event.description && (
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {event.description}
            </Typography>
          )}

          <Divider />
          <Typography variant="caption" color="text.secondary">
            Added by {event.created_by.full_name}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        {canManage && (
          <Box sx={{ mr: 'auto', display: 'flex', gap: 1 }}>
            <Button startIcon={<EditIcon />} onClick={onEdit}>
              Edit
            </Button>
            <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={onDelete}>
              Delete
            </Button>
          </Box>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default EventDetailDialog;
