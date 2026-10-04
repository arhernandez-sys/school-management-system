import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import { useTeachersList } from '@features/teachers/hooks/useTeachers';
import { useProgramHeads, useSetProgramHeads } from '../hooks/usePrograms';

export interface ProgramHeadsCardProps {
  programId: string;
  /** Dean only. Everyone else sees the names, read-only. */
  canManage: boolean;
}

/**
 * Head(s) of Department for one programme (D43).
 *
 * **Why this sits on the programme page.** A head runs a programme, so the appointment
 * is a fact about the programme, and this is where someone looking at one thinks to set
 * it. The alternative — a "heads these programmes" multi-select on the lecturer's own
 * form — describes the same edge from the other end and would have put a programme-level
 * decision inside a personnel record.
 *
 * **Appointing a head grants the role; removing them takes it back.** Saving this list
 * promotes each new head's account to Head of Department and returns a departing one to
 * Lecturer — one action, because the two-step version left the Dean having done something
 * with no visible effect until they remembered a second screen.
 *
 * Two safeguards are worth knowing while reading this file, both enforced server-side:
 * a head who still runs ANOTHER programme is not demoted when taken off this one, and an
 * account that is not a plain lecturer (a Dean who also teaches, say) is never changed in
 * either direction. So the chip list below is the whole truth of who runs this programme,
 * but it is not the whole truth of what those people's accounts can do.
 *
 * Readable by anyone who can open the programme: who to ask about a course is not a
 * confidence.
 */
export function ProgramHeadsCard({ programId, canManage }: ProgramHeadsCardProps) {
  const headsQuery = useProgramHeads(programId);
  const setHeads = useSetProgramHeads(programId);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only fetched once the Dean actually opens the editor — the card itself renders from
  // `headsQuery`, which already carries the names.
  const teachersQuery = useTeachersList(
    { page: 1, page_size: 200, sort: 'full_name' },
    editing && canManage,
  );

  const heads = headsQuery.data?.items ?? [];
  // Memoised because `?? []` is a fresh array every render, which would re-run the
  // `selected` memo below on each one.
  const options = useMemo(() => teachersQuery.data?.items ?? [], [teachersQuery.data]);

  const [draft, setDraft] = useState<string[]>([]);
  const selected = useMemo(
    () => options.filter((t) => draft.includes(t.id)),
    [options, draft],
  );


  const openEditor = () => {
    setDraft(heads.map((h) => h.teacher_id));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    setError(null);
    setHeads.mutate(draft, {
      onSuccess: () => setEditing(false),
      onError: (e) => setError(apiErrorMessage(e)),
    });
  };

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          sx={{ mb: heads.length || editing ? 1.5 : 0 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <SupervisorAccountIcon fontSize="small" color="action" />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Head{heads.length === 1 ? '' : 's'} of Department
            </Typography>
          </Stack>
          {canManage && !editing && (
            <Button size="small" onClick={openEditor} disabled={headsQuery.isLoading}>
              {heads.length ? 'Change' : 'Appoint'}
            </Button>
          )}
        </Stack>

        {editing ? (
          <Stack spacing={2}>
            <Autocomplete
              multiple
              options={options}
              loading={teachersQuery.isLoading}
              value={selected}
              onChange={(_, value) => setDraft(value.map((t) => t.id))}
              getOptionLabel={(t) => `${t.full_name} · ${t.staff_number}`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(p) => (
                <TextField
                  {...p}
                  label="Lecturers heading this programme"
                  placeholder="Search staff…"
                  helperText="Saving grants each new head the role, and returns anyone removed to Lecturer. Clearing the list removes every appointment."
                />
              )}
            />
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={() => setEditing(false)} disabled={setHeads.isPending}>
                Cancel
              </Button>
              <Button variant="contained" onClick={save} disabled={setHeads.isPending}>
                Save
              </Button>
            </Stack>
          </Stack>
        ) : heads.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No head appointed. A programme runs perfectly well without one — appointing
            someone is what gives them the department-wide view.
          </Typography>
        ) : (
          <Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {heads.map((h) => (
                <Tooltip
                  key={h.teacher_id}
                  title={
                    h.appointed_at
                      ? `Appointed ${formatSchoolDate(h.appointed_at)}`
                      : h.staff_number
                  }
                >
                  <Chip label={h.full_name} variant="outlined" />
                </Tooltip>
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default ProgramHeadsCard;
