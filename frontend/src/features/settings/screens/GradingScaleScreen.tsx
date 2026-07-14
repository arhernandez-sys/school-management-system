import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  FormControlLabel,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { PageHeader, LoadingState, ErrorState, StatusBadge } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useGradingScale, useUpdateGradingScale } from '../hooks/useSettings';
import { apiErrorMessage, hasErrorCode } from '@shared/api/errorMessages';
import type { GradingBand } from '@shared/api/generated/model';

/**
 * Grading scale (api-spec §11, FR-SET-06). Principal edits the active year's bands +
 * pass mark; others view. Contiguity over 0–100 is validated server-side — a
 * 422 grading_bands_invalid surfaces inline. An archived year's scale is frozen
 * (409 scale_frozen / is_frozen) → the form is read-only. On a successful save, if the
 * response flags `affects_displayed_grades`, we warn that derive-on-read letters change
 * going forward.
 */
type EditableBand = GradingBand & { _key: string };

let bandKeySeq = 0;
const withKey = (band: GradingBand): EditableBand => ({ ...band, _key: `band-${bandKeySeq++}` });

export function GradingScaleScreen() {
  const { user } = useAuth();
  const canEdit = user ? user.role === 'principal' : false;

  const theme = useTheme();
  // Below sm the editable band table would horizontal-scroll; render stacked cards instead.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const query = useGradingScale();
  const updateMut = useUpdateGradingScale();

  const [passMark, setPassMark] = useState<number>(60);
  const [bands, setBands] = useState<EditableBand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const frozen = query.data?.is_frozen ?? false;
  const readOnly = !canEdit || frozen;

  useEffect(() => {
    if (query.data) {
      setPassMark(query.data.pass_mark);
      setBands(query.data.bands.map(withKey));
    }
  }, [query.data]);

  if (query.isLoading) return <LoadingState variant="table" rows={6} />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const updateBand = (key: string, patch: Partial<GradingBand>) =>
    setBands((prev) => prev.map((b) => (b._key === key ? { ...b, ...patch } : b)));

  const addBand = () =>
    setBands((prev) => [
      ...prev,
      withKey({ letter: '', min_score: 0, max_score: 0, is_passing: false, sort_order: prev.length }),
    ]);

  const removeBand = (key: string) => setBands((prev) => prev.filter((b) => b._key !== key));

  const handleSave = () => {
    setError(null);
    const payload = {
      pass_mark: passMark,
      academic_year_id: query.data?.academic_year_id ?? null,
      bands: bands.map(({ _key, ...b }, i) => ({ ...b, sort_order: i })),
    };
    updateMut.mutate(
      { data: payload },
      {
        onSuccess: (res) => {
          setBands(res.bands.map(withKey));
          setPassMark(res.pass_mark);
          setSavedMessage(
            res.affects_displayed_grades
              ? 'Grading scale saved. Letter grades shown going forward will reflect the new bands.'
              : 'Grading scale saved.',
          );
        },
        onError: (err) => {
          if (hasErrorCode(err, 'grading_bands_invalid')) {
            setError(
              'The grading bands must cover 0–100 with no gaps or overlaps. Adjust the ranges and try again.',
            );
          } else {
            setError(apiErrorMessage(err));
          }
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Grading scale"
        subtitle="Letter-grade bands and the passing mark for the active academic year."
      />

      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        {frozen && (
          <Alert severity="info">
            This grading scale belongs to an archived academic year and is read-only.
          </Alert>
        )}
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <TextField
              label="Pass mark"
              type="number"
              size="small"
              value={passMark}
              onChange={(e) => setPassMark(Number(e.target.value))}
              disabled={readOnly}
              inputProps={{ min: 0, max: 100 }}
              sx={{ width: 140 }}
            />
            {frozen && <StatusBadge label="Frozen" kind="neutral" />}
          </Stack>

          {isMobile ? (
            // Mobile: each band is a stacked editable card (mirrors the DataTable card
            // view) so the row never horizontal-scrolls. Same handlers as the table.
            <Stack
              component="ul"
              spacing={1.5}
              sx={{ listStyle: 'none', p: 0, m: 0 }}
              aria-label="Grading bands"
            >
              {bands.map((band) => (
                <Card key={band._key} component="li" variant="outlined">
                  <CardContent>
                    <Stack spacing={1.5}>
                      <TextField
                        label="Letter"
                        value={band.letter}
                        onChange={(e) => updateBand(band._key, { letter: e.target.value })}
                        size="small"
                        disabled={readOnly}
                        inputProps={{ maxLength: 8 }}
                        fullWidth
                      />
                      <Stack direction="row" spacing={1.5}>
                        <TextField
                          label="Min score"
                          type="number"
                          value={band.min_score}
                          onChange={(e) =>
                            updateBand(band._key, { min_score: Number(e.target.value) })
                          }
                          size="small"
                          disabled={readOnly}
                          inputProps={{ min: 0, max: 100 }}
                          fullWidth
                        />
                        <TextField
                          label="Max score"
                          type="number"
                          value={band.max_score}
                          onChange={(e) =>
                            updateBand(band._key, { max_score: Number(e.target.value) })
                          }
                          size="small"
                          disabled={readOnly}
                          inputProps={{ min: 0, max: 100 }}
                          fullWidth
                        />
                      </Stack>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={band.is_passing ?? false}
                            onChange={(e) =>
                              updateBand(band._key, { is_passing: e.target.checked })
                            }
                            disabled={readOnly}
                          />
                        }
                        label="Passing grade"
                      />
                    </Stack>
                  </CardContent>
                  {!readOnly && (
                    <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutlineIcon />}
                        onClick={() => removeBand(band._key)}
                        aria-label={`Remove band ${band.letter || ''}`}
                      >
                        Remove
                      </Button>
                    </CardActions>
                  )}
                </Card>
              ))}
            </Stack>
          ) : (
            <Table size="small" aria-label="Grading bands">
              <TableHead>
                <TableRow>
                  <TableCell>Letter</TableCell>
                  <TableCell>Min score</TableCell>
                  <TableCell>Max score</TableCell>
                  <TableCell>Passing</TableCell>
                  {!readOnly && <TableCell align="right">Remove</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {bands.map((band) => (
                  <TableRow key={band._key}>
                    <TableCell>
                      <TextField
                        value={band.letter}
                        onChange={(e) => updateBand(band._key, { letter: e.target.value })}
                        size="small"
                        disabled={readOnly}
                        inputProps={{ maxLength: 8, 'aria-label': 'Band letter' }}
                        sx={{ width: 80 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        type="number"
                        value={band.min_score}
                        onChange={(e) =>
                          updateBand(band._key, { min_score: Number(e.target.value) })
                        }
                        size="small"
                        disabled={readOnly}
                        inputProps={{ min: 0, max: 100, 'aria-label': 'Minimum score' }}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        type="number"
                        value={band.max_score}
                        onChange={(e) =>
                          updateBand(band._key, { max_score: Number(e.target.value) })
                        }
                        size="small"
                        disabled={readOnly}
                        inputProps={{ min: 0, max: 100, 'aria-label': 'Maximum score' }}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={band.is_passing ?? false}
                        onChange={(e) => updateBand(band._key, { is_passing: e.target.checked })}
                        disabled={readOnly}
                        aria-label={`${band.letter || 'Band'} is passing`}
                      />
                    </TableCell>
                    {!readOnly && (
                      <TableCell align="right">
                        <Tooltip title="Remove band">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeBand(band._key)}
                            aria-label={`Remove band ${band.letter || ''}`}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!readOnly && (
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button startIcon={<AddIcon />} onClick={addBand} size="small">
                Add band
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={updateMut.isPending || bands.length === 0}
              >
                {updateMut.isPending ? 'Saving…' : 'Save scale'}
              </Button>
            </Stack>
          )}
        </Paper>

        <Typography variant="body2" color="text.secondary">
          Bands must be contiguous and cover the full 0–100 range with no gaps or overlaps.
          Changing the scale affects the letter grades derived from scores going forward.
        </Typography>
      </Stack>

      <Snackbar
        open={Boolean(savedMessage)}
        autoHideDuration={5000}
        onClose={() => setSavedMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSavedMessage(null)}>
          {savedMessage}
        </Alert>
      </Snackbar>
    </>
  );
}

export default GradingScaleScreen;
