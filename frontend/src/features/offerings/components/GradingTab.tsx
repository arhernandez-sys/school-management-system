import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormDialog,
  LoadingState,
  StatusBadge,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import {
  useAssessmentCategoryList,
  useCreateAssessmentCategory,
  useDeleteAssessmentCategory,
  useUpdateAssessmentCategory,
  type AssessmentCategory,
} from '@features/assessments/hooks/useAssessments';

/**
 * Offering detail → Grading tab. The offering's assessment categories and their weights
 * (D45 §24: "Assignments 20, Quizzes 15, Midterm 25, Final 30, Participation 10").
 *
 * Categories hang off the OFFERING because the offering is the gradebook — the same course
 * taught next semester gets its own scheme. Before this tab the API existed but no screen
 * reached it, so the only way to create one was to call the endpoint with an offering id.
 *
 * **The 100% total is a verdict, not a gate.** The server accepts any weight and reports
 * `weight_total_ok`, because a scheme is built one row at a time and is "wrong" at every
 * step until the last. This tab shows the running total and says what is missing.
 *
 * Who edits: the offering's lecturer and the Dean. Everyone else who can open the offering
 * reads it. The server decides; `canEdit` only hides buttons.
 */
export interface GradingTabProps {
  offeringId: string;
  offeringLabel: string;
  canEdit: boolean;
}

interface Draft {
  id: string | null;
  name: string;
  weight: string;
  drop: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: '', weight: '', drop: '0' };

function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}

export function GradingTab({ offeringId, offeringLabel, canEdit }: GradingTabProps) {
  const query = useAssessmentCategoryList(offeringId);
  const createMut = useCreateAssessmentCategory(offeringId);
  const updateMut = useUpdateAssessmentCategory(offeringId);
  const deleteMut = useDeleteAssessmentCategory(offeringId);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AssessmentCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (query.isLoading) return <LoadingState variant="form" label="Loading grading scheme" />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const data = query.data;
  const items = data?.items ?? [];
  const total = data?.weight_total ?? 0;
  const uncategorized = data?.uncategorized_assessment_count ?? 0;
  const remaining = Math.round((100 - total) * 100) / 100;

  const openCreate = () => {
    setFormError(null);
    setDraft({ ...EMPTY_DRAFT, weight: remaining > 0 ? String(remaining) : '' });
  };
  const openEdit = (c: AssessmentCategory) => {
    setFormError(null);
    setDraft({ id: c.id, name: c.name, weight: String(c.weight), drop: String(c.drop_lowest_count) });
  };

  const weightNum = draft ? Number(draft.weight) : NaN;
  const dropNum = draft ? Number(draft.drop || 0) : NaN;
  const draftInvalid =
    !draft ||
    !draft.name.trim() ||
    draft.weight.trim() === '' ||
    !Number.isFinite(weightNum) ||
    weightNum < 0 ||
    weightNum > 100 ||
    !Number.isInteger(dropNum) ||
    dropNum < 0;

  const submit = () => {
    if (!draft || draftInvalid) return;
    const body = { name: draft.name.trim(), weight: weightNum, drop_lowest_count: dropNum };
    const opts = {
      onSuccess: () => setDraft(null),
      onError: (err: unknown) => setFormError(apiErrorMessage(err)),
    };
    if (draft.id) updateMut.mutate({ id: draft.id, body }, opts);
    else createMut.mutate(body, opts);
  };

  const verdict = (() => {
    if (items.length === 0) return null;
    if (data?.weight_total_ok) {
      return <Alert severity="success">Weights total 100%. This scheme is complete.</Alert>;
    }
    const parts: string[] = [];
    if (total !== 100) {
      parts.push(
        total < 100
          ? `Weights total ${fmtPct(total)} — ${fmtPct(remaining)} still to assign.`
          : `Weights total ${fmtPct(total)} — ${fmtPct(-remaining)} over 100%.`,
      );
    }
    if (uncategorized > 0) {
      parts.push(
        `${uncategorized} assessment${uncategorized === 1 ? ' is' : 's are'} not in any category. ` +
          'Assign them from the Grades screen.',
      );
    }
    return <Alert severity="warning">{parts.join(' ')}</Alert>;
  })();

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Typography variant="body2" color="text.secondary">
          How {offeringLabel}'s course grade is made up. Each assessment is placed in one of
          these categories; the category's weight is its share of the final grade.
        </Typography>
        {canEdit && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreate}
            sx={{ flexShrink: 0 }}
          >
            Add category
          </Button>
        )}
      </Stack>

      {items.length === 0 ? (
        <EmptyState
          variant="card"
          title="No grading categories yet"
          description={
            canEdit
              ? 'Add categories such as Assignments 20%, Quizzes 15%, Midterm 25%, Final 30% and Participation 10%, so they total 100%.'
              : 'The lecturer or the Dean has not set up the grading categories for this offering yet.'
          }
          action={canEdit ? { label: 'Add category', onClick: openCreate } : undefined}
        />
      ) : (
        <>
          {verdict}
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table
              size="small"
              aria-label="Grading categories"
              // Tighter gutters on a phone so the edit/delete pair fits beside the numbers.
              sx={{ '& th, & td': { px: { xs: 1, sm: 2 } } }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Weight</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                      Drop lowest
                    </Box>
                    <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                      Drop
                    </Box>
                  </TableCell>
                  {canEdit && <TableCell align="right" />}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.name}</TableCell>
                    <TableCell align="right">{fmtPct(c.weight)}</TableCell>
                    <TableCell align="right">
                      {c.drop_lowest_count > 0 ? c.drop_lowest_count : '—'}
                    </TableCell>
                    {canEdit && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Edit">
                          <IconButton size="small" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c)}>
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            aria-label={`Delete ${c.name}`}
                            onClick={() => {
                              setDeleteError(null);
                              setToDelete(c);
                            }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
              {/* MUI shrinks footer text to caption size; the total is the point of the table. */}
              <TableFooter sx={{ '& td': { fontSize: '0.875rem' } }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>
                    <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
                      {fmtPct(total)}
                      <StatusBadge
                        label={total === 100 ? 'OK' : total < 100 ? 'Under' : 'Over'}
                        kind={total === 100 ? 'success' : 'warning'}
                      />
                    </Box>
                  </TableCell>
                  <TableCell />
                  {canEdit && <TableCell />}
                </TableRow>
              </TableFooter>
            </Table>
          </Paper>
        </>
      )}

      {canEdit && (
        <FormDialog
          open={draft !== null}
          title={draft?.id ? 'Edit category' : 'Add category'}
          submitLabel={draft?.id ? 'Save' : 'Add'}
          submitting={createMut.isPending || updateMut.isPending}
          submitDisabled={draftInvalid}
          error={formError}
          maxWidth="xs"
          onSubmit={submit}
          onClose={() => setDraft(null)}
        >
          {draft && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Category name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Quizzes"
                required
                autoFocus
                inputProps={{ maxLength: 100 }}
              />
              <TextField
                label="Weight (%)"
                type="number"
                value={draft.weight}
                onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
                required
                inputProps={{ min: 0, max: 100, step: 0.5 }}
                error={draft.weight !== '' && (weightNum < 0 || weightNum > 100)}
                helperText={
                  draft.id
                    ? 'Share of the final course grade.'
                    : `Share of the final course grade. ${fmtPct(Math.max(remaining, 0))} is still unassigned.`
                }
              />
              <TextField
                label="Drop lowest"
                type="number"
                value={draft.drop}
                onChange={(e) => setDraft({ ...draft, drop: e.target.value })}
                inputProps={{ min: 0, step: 1 }}
                helperText="How many of the lowest scores in this category are ignored. Usually 0."
              />
            </Stack>
          )}
        </FormDialog>
      )}

      {canEdit && (
        <ConfirmDialog
          open={toDelete !== null}
          title="Delete category?"
          description={
            toDelete
              ? `"${toDelete.name}" (${fmtPct(toDelete.weight)}) will be removed. Any assessments in it are kept but become uncategorized.`
              : undefined
          }
          confirmLabel="Delete"
          destructive
          pending={deleteMut.isPending}
          error={deleteError}
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            if (!toDelete) return;
            deleteMut.mutate(toDelete.id, {
              onSuccess: () => setToDelete(null),
              onError: (err) => setDeleteError(apiErrorMessage(err)),
            });
          }}
        />
      )}
    </Stack>
  );
}

export default GradingTab;
