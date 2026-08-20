import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Paper, Stack, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { EmptyState, ErrorState, LoadingState } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useOfferingMeetings, useReplaceMeetings } from '../hooks/useOfferings';
import { DAY_LONG, formatTimeRange, meetingRowInvalid } from '../meetingFormat';
import { MeetingRowsEditor } from './MeetingRowsEditor';
import type { OfferingMeetingInput, ScheduleConflict } from '../types';

/**
 * Offering detail → Schedule tab. The offering's Mon–Fri meeting rows (FR-SCH-01/02).
 *
 * The write is `PUT /offerings/{id}/meetings`, which REPLACES the whole week, so this edits
 * a local draft and saves it in one request. That mirrors the API rather than fighting it: a
 * retimed week cannot half-apply, and there is no per-row save button to leave the screen in
 * a partially-written state.
 *
 * **Conflicts are warnings, not errors.** A successful save can still return lecturer/room
 * clashes; the tab shows them and keeps the saved schedule. Hard-blocking would make an
 * otherwise-valid week unsaveable (a room can legitimately be shared, and a clash is often
 * fixed by the next edit) — the same warn-only call already made for over-capacity
 * enrollment. So `conflicts.length > 0` must never be treated as failure.
 *
 * Read-only for a viewer who cannot manage offerings: lecturers and students see when the
 * course meets, only the office changes it.
 *
 * Room is edited PER MEETING, not per offering — `course_offerings` has no `room` column,
 * because one course legitimately meets in a lecture room on Monday and a lab on Wednesday.
 */
export interface ScheduleTabProps {
  offeringId: string;
  /** The server-computed offering label, for captions and empty-state copy. */
  offeringLabel: string;
  canManage: boolean;
}

/** Server meetings → editable draft rows (drop ids; the PUT is a replace). */
function toDraft(
  meetings: { day_of_week: number; start_time: string; end_time: string; room: string | null }[],
): OfferingMeetingInput[] {
  return meetings.map((m) => ({
    day_of_week: m.day_of_week as OfferingMeetingInput['day_of_week'],
    // Trim the seconds the API serves; `<input type="time">` expects HH:MM.
    start_time: m.start_time.slice(0, 5),
    end_time: m.end_time.slice(0, 5),
    room: m.room ?? '',
  }));
}

function sameDraft(a: OfferingMeetingInput[], b: OfferingMeetingInput[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ScheduleTab({ offeringId, offeringLabel, canManage }: ScheduleTabProps) {
  const query = useOfferingMeetings(offeringId);
  const saveMut = useReplaceMeetings(offeringId);

  const server = useMemo(() => toDraft(query.data?.meetings ?? []), [query.data]);
  const [draft, setDraft] = useState<OfferingMeetingInput[]>([]);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-seed the draft whenever the server copy changes (first load, or a refetch after
  // save). Keyed on the serialized value rather than the array identity, which is new on
  // every render of the parent.
  const serverKey = JSON.stringify(server);
  useEffect(() => {
    setDraft(toDraft(query.data?.meetings ?? []));
    setConflicts(query.data?.conflicts ?? []);
  }, [serverKey, query.data]);

  if (query.isLoading) return <LoadingState variant="form" label="Loading schedule" />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const dirty = !sameDraft(draft, server);
  const invalid = draft.some(meetingRowInvalid);

  const handleSave = () => {
    setSaveError(null);
    setSaved(false);
    saveMut.mutate(
      { meetings: draft.map((m) => ({ ...m, room: m.room?.trim() || null })) },
      {
        onSuccess: (res) => {
          // A non-empty `conflicts` is still a SUCCESS — the week saved.
          setConflicts(res.conflicts);
          setSaved(true);
        },
        onError: (err) => setSaveError(apiErrorMessage(err)),
      },
    );
  };

  // Read-only view: no editor, just the week as text.
  if (!canManage) {
    if (draft.length === 0) {
      return (
        <EmptyState
          variant="card"
          title="No schedule yet"
          description={`${offeringLabel} does not have meeting times set. The office adds them.`}
        />
      );
    }
    return (
      <Stack spacing={1.5}>
        {draft.map((m, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0.5, sm: 2 }}
              alignItems={{ sm: 'baseline' }}
            >
              <Typography variant="subtitle2" sx={{ minWidth: 100 }}>
                {DAY_LONG[m.day_of_week]}
              </Typography>
              <Typography variant="body2">
                {formatTimeRange(m.start_time, m.end_time)}
              </Typography>
              {m.room && (
                <Typography variant="body2" color="text.secondary">
                  {m.room}
                </Typography>
              )}
            </Stack>
          </Paper>
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        When {offeringLabel} meets each week. Students see this on their timetable.
      </Typography>

      {saveError && <Alert severity="error">{saveError}</Alert>}

      {saved && conflicts.length === 0 && (
        <Alert severity="success" onClose={() => setSaved(false)}>
          Schedule saved.
        </Alert>
      )}

      {conflicts.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>
            {saved ? 'Saved, but there ' : 'There '}
            {conflicts.length === 1 ? 'is 1 clash' : `are ${conflicts.length} clashes`}
          </AlertTitle>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
            {conflicts.map((c, i) => (
              <Typography key={i} component="li" variant="body2">
                {c.message}
              </Typography>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            These are warnings — the schedule is saved either way.
          </Typography>
        </Alert>
      )}

      {draft.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No meetings yet. Add one to put this offering on students' timetables.
        </Typography>
      )}

      <MeetingRowsEditor value={draft} onChange={setDraft} disabled={saveMut.isPending} />

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        {dirty && (
          <Button
            onClick={() => {
              setDraft(server);
              setSaveError(null);
            }}
            disabled={saveMut.isPending}
          >
            Discard changes
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!dirty || invalid || saveMut.isPending}
        >
          {saveMut.isPending ? 'Saving…' : 'Save schedule'}
        </Button>
      </Box>
    </Stack>
  );
}

export default ScheduleTab;
