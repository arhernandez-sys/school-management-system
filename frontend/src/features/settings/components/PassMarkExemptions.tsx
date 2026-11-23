import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useProgramsList, useUpdateProgram } from '@features/programs/hooks/usePrograms';
import type { ProgramListItem } from '@features/programs/types';
import { apiErrorMessage } from '@shared/api/errorMessages';
import type { GradingBand } from '@shared/api/generated/model';

/**
 * The global pass mark: C+ (2.50). It is `programs.min_passing_grade_point`'s column
 * default and the backend's `_DEFAULT_MIN_GRADE_POINT` — what a programme passes at unless
 * it is exempted. NOT derived from the bands' "Passing" ticks: the seeded scale ticks C as
 * passing too, which would make 2.00 look global and list every C+ programme as an
 * exemption.
 */
const GLOBAL_GP = 2.5;

export interface PassMarkExemptionsProps {
  /** The SAVED bands (server state), not the unsaved edits in the table above. */
  bands: GradingBand[];
  canEdit: boolean;
}

/**
 * Programme pass-mark exemptions (client request, 14 Oct 2026).
 *
 * The global pass mark is C+ (2.50, see `GLOBAL_GP`). A programme can pass at a different
 * grade — Primary
 * Education passes at C (2.00). That is not new storage: it is `programs.
 * min_passing_grade_point`, which the prerequisite gate and the student academic record
 * already read. This panel is just the place to see and set it next to the scale.
 *
 * An "exemption" is any programme whose pass mark differs from the global one. Adding one
 * PATCHes that programme's grade point; removing one resets it to the global value, so
 * every programme not listed here follows the scale above.
 */
export function PassMarkExemptions({ bands, canEdit }: PassMarkExemptionsProps) {
  const programsQuery = useProgramsList({ page: 1, page_size: 100 });
  const updateMut = useUpdateProgram();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [programId, setProgramId] = useState('');
  const [gradePoint, setGradePoint] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Bands that carry a grade point, highest first — the choices for a pass mark. */
  const pricedBands = useMemo(
    () =>
      bands
        .filter((b) => b.grade_point != null)
        .sort((a, b) => Number(b.grade_point) - Number(a.grade_point)),
    [bands],
  );

  const globalGp = GLOBAL_GP;

  const describe = (gp: number) => {
    const band = pricedBands.find((b) => Number(b.grade_point) === gp);
    return band
      ? `${band.letter} (${gp.toFixed(2)}) — ${band.min_score} and above`
      : `${gp.toFixed(2)} grade point`;
  };

  const programs = programsQuery.data?.items ?? [];
  const exemptions = programs.filter((p) => Number(p.min_passing_grade_point) !== globalGp);

  const openDialog = (program?: ProgramListItem) => {
    setError(null);
    setProgramId(program?.id ?? '');
    setGradePoint(program ? Number(program.min_passing_grade_point).toFixed(2) : '');
    setDialogOpen(true);
  };

  const setPassMark = (id: string, gp: number, onDone?: () => void) => {
    setError(null);
    updateMut.mutate(
      { id, body: { min_passing_grade_point: gp.toFixed(2) } },
      { onSuccess: onDone, onError: (err) => setError(apiErrorMessage(err)) },
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ mb: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Programme exemptions
        </Typography>
        {canEdit && (
          <Button
            startIcon={<AddIcon />}
            size="small"
            variant="outlined"
            onClick={() => openDialog()}
            disabled={programs.length === 0 || pricedBands.length === 0}
          >
            Exemption
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Programmes listed here pass at their own grade. Every other programme uses the global
        scale above: passing is {describe(globalGp)}.
      </Typography>

      {error && !dialogOpen && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {programsQuery.isLoading ? (
        <Typography variant="body2" color="text.secondary">
          Loading programmes…
        </Typography>
      ) : programsQuery.isError ? (
        <Alert severity="error">We couldn't load the programmes.</Alert>
      ) : exemptions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No exemptions — every programme uses the global scale.
        </Typography>
      ) : (
        <List dense disablePadding aria-label="Programme exemptions">
          {exemptions.map((p) => (
            <ListItem
              key={p.id}
              divider
              secondaryAction={
                canEdit && (
                  <Tooltip title="Remove exemption (use the global scale)">
                    <IconButton
                      edge="end"
                      size="small"
                      color="error"
                      disabled={updateMut.isPending}
                      onClick={() => setPassMark(p.id, globalGp)}
                      aria-label={`Remove exemption for ${p.name}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              }
            >
              <ListItemText
                primary={`${p.code} — ${p.name}`}
                secondary={`Passes at ${describe(Number(p.min_passing_grade_point))}`}
                sx={{ cursor: canEdit ? 'pointer' : undefined }}
                onClick={canEdit ? () => openDialog(p) : undefined}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Programme exemption</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
            <TextField
              select
              label="Programme"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              required
              fullWidth
            >
              {programs.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Passing mark"
              value={gradePoint}
              onChange={(e) => setGradePoint(e.target.value)}
              required
              fullWidth
              helperText="The lowest grade that counts as a pass for this programme."
            >
              {pricedBands.map((b) => (
                <MenuItem key={b.letter} value={Number(b.grade_point).toFixed(2)}>
                  {b.letter} ({Number(b.grade_point).toFixed(2)}) — {b.min_score} and above
                </MenuItem>
              ))}
            </TextField>
            {gradePoint !== '' && Number(gradePoint) === globalGp && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  This is the same as the global scale, so the programme will not be listed as
                  an exemption.
                </Typography>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={updateMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!programId || gradePoint === '' || updateMut.isPending}
            onClick={() => setPassMark(programId, Number(gradePoint), () => setDialogOpen(false))}
          >
            {updateMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export default PassMarkExemptions;
