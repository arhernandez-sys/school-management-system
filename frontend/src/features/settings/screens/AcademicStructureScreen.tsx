import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Divider,
  IconButton,
  MenuItem,
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
import EditIcon from '@mui/icons-material/Edit';
import {
  PageHeader,
  LoadingState,
  ErrorState,
  StatusBadge,
  FormDialog,
  ConfirmDialog,
} from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import {
  useAcademicYears,
  useCreateAcademicYear,
  useActivateSemester,
  useArchiveAcademicYear,
  useCreateSemester,
  useUpdateSemester,
} from '../hooks/useSettings';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { TermFormDialog, type TermFormValues } from '../components/TermFormDialog';
import type {
  AcademicYearDetail,
  SemesterDetail,
  TermType,
} from '@shared/api/generated/model';

/** One term row in the create-year dialog. Local shape — the API takes these as
 *  `semesters[]` on the year. */
interface DraftTerm {
  key: string;
  name: string;
  term_type: TermType;
  sequence: number;
  start_date: string;
  end_date: string;
}

const TERM_KINDS: { value: TermType; label: string }[] = [
  { value: 'semester', label: 'Semester' },
  { value: 'summer', label: 'Summer block' },
  { value: 'spring', label: 'Spring block' },
];

/**
 * A stored UTC deadline, rendered in the reader's own timezone (D30 §D6). Shown to the
 * minute: "grades due on the 15th" is not the same instruction as "grades due 17:00 on
 * the 15th", and the second is the one that is actually enforced.
 */
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function blankTerm(sequence: number, name: string): DraftTerm {
  return {
    key: `t-${sequence}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    term_type: 'semester',
    sequence,
    start_date: '',
    end_date: '',
  };
}

/**
 * Academic structure (api-spec §11; **D30 §D3 — N calendar terms per year**).
 *
 * Lists academic years with their terms. Principal/Secretary can:
 *  - Create a year with ONE OR MORE terms — 409 active_year_exists surfaced.
 *  - Add a term to an existing year, or correct one (Dean only).
 *  - Activate a term — conflicts surfaced.
 *  - Archive a year (confirm dialog warns it freezes the year) — 202 accepted;
 *    409 year_already_archived surfaced.
 *
 * WHAT CHANGED IN D30 AND WHY. This screen used to hard-code exactly two semesters,
 * because the schema did: `semesters.sequence` carried `CHECK (sequence IN (1,2))`
 * and there was no endpoint to add a third. BAJC's programmes run Summer and Spring
 * blocks alongside the numbered semesters — Primary Education has eight positions in
 * its plan — so both the cap and the fixed two-semester form had to go.
 *
 * These are CALENDAR terms. A course's position in a programme's plan is a different
 * fact and lives under Settings → Programmes (§D3).
 */
export function AcademicStructureScreen() {
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'settings') : false;

  const theme = useTheme();
  // Below sm the per-year semester table would horizontal-scroll; stack cards instead.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const query = useAcademicYears();
  const createMut = useCreateAcademicYear();
  const activateMut = useActivateSemester();
  const archiveMut = useArchiveAcademicYear();
  const createTermMut = useCreateSemester();
  const updateTermMut = useUpdateSemester();

  // ── create-year dialog ──────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [yearName, setYearName] = useState('');
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');
  // D30: a LIST, not two fixed slots. Seeded with the two-semester shape because that
  // is still the common case; a Summer or Spring block is now one click away.
  const [terms, setTerms] = useState<DraftTerm[]>([
    blankTerm(1, 'Semester 1'),
    blankTerm(2, 'Semester 2'),
  ]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({});

  // ── add / edit ONE term (D30 §D3) ───────────────────────────────────────────
  const [termDialogYear, setTermDialogYear] = useState<AcademicYearDetail | null>(null);
  const [termDialogTerm, setTermDialogTerm] = useState<SemesterDetail | null>(null);
  const [termError, setTermError] = useState<string | null>(null);
  const [termFieldErrors, setTermFieldErrors] = useState<Record<string, string[]>>({});

  // ── archive confirm / activate error ─────────────────────────────────────────
  const [archiveTarget, setArchiveTarget] = useState<AcademicYearDetail | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  if (query.isLoading) return <LoadingState variant="cards" rows={2} />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const years = query.data.items;

  const resetCreateForm = () => {
    setYearName('');
    setYearStart('');
    setYearEnd('');
    setTerms([blankTerm(1, 'Semester 1'), blankTerm(2, 'Semester 2')]);
    setCreateError(null);
    setCreateFieldErrors({});
  };

  const openCreate = () => {
    resetCreateForm();
    setCreateOpen(true);
  };

  const patchTerm = (key: string, patch: Partial<DraftTerm>) =>
    setTerms((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const addTermRow = () =>
    setTerms((prev) => [
      ...prev,
      blankTerm(
        prev.length ? Math.max(...prev.map((t) => t.sequence)) + 1 : 1,
        `Semester ${prev.length + 1}`,
      ),
    ]);

  // A year needs at least one term, so the last row cannot be removed.
  const removeTermRow = (key: string) =>
    setTerms((prev) => (prev.length > 1 ? prev.filter((t) => t.key !== key) : prev));

  const sequences = terms.map((t) => t.sequence);
  const duplicateSequence = sequences.length !== new Set(sequences).size;

  const createValid = Boolean(
    yearName.trim() &&
      yearStart &&
      yearEnd &&
      terms.length > 0 &&
      !duplicateSequence &&
      terms.every(
        (t) => t.name.trim() && t.start_date && t.end_date && t.end_date > t.start_date,
      ),
  );

  const handleCreate = () => {
    setCreateError(null);
    setCreateFieldErrors({});
    createMut.mutate(
      {
        data: {
          name: yearName.trim(),
          start_date: yearStart,
          end_date: yearEnd,
          semesters: terms.map((t) => ({
            name: t.name.trim(),
            term_type: t.term_type,
            sequence: t.sequence,
            start_date: t.start_date,
            end_date: t.end_date,
          })),
        },
      },
      {
        onSuccess: () => setCreateOpen(false),
        onError: (err) => {
          setCreateError(apiErrorMessage(err));
          const fields = fieldErrorsFrom(err);
          if (fields) setCreateFieldErrors(fields);
        },
      },
    );
  };

  // ── one term ────────────────────────────────────────────────────────────────
  const openAddTerm = (year: AcademicYearDetail) => {
    setTermDialogTerm(null);
    setTermError(null);
    setTermFieldErrors({});
    setTermDialogYear(year);
  };

  const openEditTerm = (year: AcademicYearDetail, term: SemesterDetail) => {
    setTermDialogTerm(term);
    setTermError(null);
    setTermFieldErrors({});
    setTermDialogYear(year);
  };

  const closeTermDialog = () => {
    setTermDialogYear(null);
    setTermDialogTerm(null);
  };

  const handleTermSubmit = (values: TermFormValues) => {
    setTermError(null);
    setTermFieldErrors({});
    const onError = (err: unknown) => {
      setTermError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setTermFieldErrors(fields);
    };
    if (termDialogTerm) {
      updateTermMut.mutate(
        { semesterId: termDialogTerm.id, body: values },
        { onSuccess: closeTermDialog, onError },
      );
    } else if (termDialogYear) {
      createTermMut.mutate(
        { ...values, academic_year_id: termDialogYear.id },
        { onSuccess: closeTermDialog, onError },
      );
    }
  };

  const handleActivate = (semesterId: string) => {
    setActivateError(null);
    activateMut.mutate(
      { semesterId },
      { onError: (err) => setActivateError(apiErrorMessage(err)) },
    );
  };

  const handleArchive = () => {
    if (!archiveTarget) return;
    setArchiveError(null);
    archiveMut.mutate(
      { yearId: archiveTarget.id },
      {
        onSuccess: () => setArchiveTarget(null),
        onError: (err) => setArchiveError(apiErrorMessage(err)),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Academic structure"
        subtitle="Academic years and the calendar terms in them. A year can hold as many terms as the college runs — semesters, Summer and Spring blocks."
        primaryAction={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New academic year
            </Button>
          ) : undefined
        }
      />

      {activateError && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {activateError}
        </Alert>
      )}

      {years.length === 0 ? (
        <Alert severity="info">No academic years yet. Create one to begin.</Alert>
      ) : (
        <Stack spacing={2}>
          {years.map((year) => {
            const isArchived = year.status === 'archived';
            return (
              <Card key={year.id} variant="outlined">
                <CardContent>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ sm: 'center' }}
                    sx={{ mb: 1 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="h4" component="h2">
                        {year.name}
                      </Typography>
                      <StatusBadge
                        label={isArchived ? 'Archived' : 'Active'}
                        kind={isArchived ? 'neutral' : 'success'}
                      />
                    </Stack>
                    {canManage && !isArchived && (
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => openAddTerm(year)}
                        >
                          Add term
                        </Button>
                        <Button
                          color="warning"
                          size="small"
                          onClick={() => {
                            setArchiveError(null);
                            setArchiveTarget(year);
                          }}
                        >
                          Archive year
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {year.start_date} → {year.end_date}
                  </Typography>
                  <Divider sx={{ mb: 1 }} />
                  {isMobile ? (
                    // Mobile: each semester is a stacked card (mirrors the DataTable card
                    // view) so the row never horizontal-scrolls. Same handlers as the table.
                    <Stack
                      component="ul"
                      spacing={1.5}
                      sx={{ listStyle: 'none', p: 0, m: 0 }}
                      aria-label={`Semesters for ${year.name}`}
                    >
                      {year.semesters.map((sem) => (
                        <Card key={sem.id} component="li" variant="outlined">
                          <CardContent>
                            <Typography
                              variant="subtitle1"
                              component="div"
                              sx={{ fontWeight: 600, mb: 1 }}
                            >
                              {sem.name}
                            </Typography>
                            <Stack spacing={1}>
                              <Box
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 2,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <Typography variant="caption" color="text.secondary">
                                  Kind
                                </Typography>
                                <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                                  {sem.term_type}
                                </Typography>
                              </Box>
                              <Box
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 2,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <Typography variant="caption" color="text.secondary">
                                  Dates
                                </Typography>
                                <Typography variant="body2">
                                  {sem.start_date} → {sem.end_date}
                                </Typography>
                              </Box>
                              <Box
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: 2,
                                }}
                              >
                                <Typography variant="caption" color="text.secondary">
                                  Status
                                </Typography>
                                {sem.is_active ? (
                                  <StatusBadge label="Active" kind="success" />
                                ) : (
                                  <StatusBadge label="Inactive" kind="neutral" />
                                )}
                              </Box>
                            </Stack>
                          </CardContent>
                          {canManage && !isArchived && (
                            <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                              <Button size="small" onClick={() => openEditTerm(year, sem)}>
                                Edit
                              </Button>
                              {!sem.is_active && (
                                <Button
                                  size="small"
                                  onClick={() => handleActivate(sem.id)}
                                  disabled={activateMut.isPending}
                                >
                                  Activate
                                </Button>
                              )}
                            </CardActions>
                          )}
                        </Card>
                      ))}
                    </Stack>
                  ) : (
                    <Table size="small" aria-label={`Terms for ${year.name}`}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Term</TableCell>
                          <TableCell>Kind</TableCell>
                          <TableCell>Dates</TableCell>
                          <TableCell>Status</TableCell>
                          {canManage && !isArchived && <TableCell align="right" />}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {year.semesters.map((sem) => (
                          <TableRow key={sem.id}>
                            <TableCell>{sem.name}</TableCell>
                            <TableCell sx={{ textTransform: 'capitalize' }}>
                              {sem.term_type}
                            </TableCell>
                            <TableCell>
                              {sem.start_date} → {sem.end_date}
                              {/* D30 §D6 — a closed grade window is the reason a Lecturer
                                  cannot save, so it belongs on the term row rather than
                                  only inside the edit dialog. */}
                              {sem.grade_submission_deadline && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block' }}
                                >
                                  Grades due {formatDeadline(sem.grade_submission_deadline)}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              {sem.is_active ? (
                                <StatusBadge label="Active" kind="success" />
                              ) : (
                                <StatusBadge label="Inactive" kind="neutral" />
                              )}
                            </TableCell>
                            {canManage && !isArchived && (
                              <TableCell align="right">
                                {!sem.is_active && (
                                  <Button
                                    size="small"
                                    onClick={() => handleActivate(sem.id)}
                                    disabled={activateMut.isPending}
                                  >
                                    Activate
                                  </Button>
                                )}
                                <Tooltip title="Edit term">
                                  <IconButton
                                    size="small"
                                    aria-label={`Edit ${sem.name}`}
                                    onClick={() => openEditTerm(year, sem)}
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Create academic year */}
      <FormDialog
        open={createOpen}
        title="New academic year"
        submitLabel="Create year"
        maxWidth="md"
        submitting={createMut.isPending}
        submitDisabled={!createValid}
        error={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info">
            A new year cannot be created while another year is active — archive the active year
            first.
          </Alert>
          <TextField
            label="Year name"
            value={yearName}
            onChange={(e) => setYearName(e.target.value)}
            required
            fullWidth
            placeholder="e.g. 2026–2027"
            error={Boolean(createFieldErrors.name)}
            helperText={createFieldErrors.name?.join(' ')}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Year start"
              type="date"
              value={yearStart}
              onChange={(e) => setYearStart(e.target.value)}
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Year end"
              type="date"
              value={yearEnd}
              onChange={(e) => setYearEnd(e.target.value)}
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          {/* D30 §D3 — terms are a LIST. This used to be two fixed blocks of fields,
              which is why BAJC's Summer and Spring blocks could not be entered. */}
          <Divider>Terms</Divider>
          {duplicateSequence && (
            <Alert severity="warning">
              Two terms share an order number. Each term needs its own position within the
              year.
            </Alert>
          )}
          {terms.map((term, index) => (
            <Box
              key={term.key}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1 }}
              >
                <Typography variant="subtitle2">Term {index + 1}</Typography>
                {terms.length > 1 && (
                  <Tooltip title="Remove this term">
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`Remove term ${index + 1}`}
                      onClick={() => removeTermRow(term.key)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Name"
                    value={term.name}
                    onChange={(e) => patchTerm(term.key, { name: e.target.value })}
                    required
                    fullWidth
                    placeholder="e.g. Summer 1"
                  />
                  <TextField
                    select
                    label="Kind"
                    value={term.term_type}
                    onChange={(e) =>
                      patchTerm(term.key, { term_type: e.target.value as TermType })
                    }
                    fullWidth
                  >
                    {TERM_KINDS.map((k) => (
                      <MenuItem key={k.value} value={k.value}>
                        {k.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Order"
                    type="number"
                    value={term.sequence}
                    onChange={(e) =>
                      patchTerm(term.key, { sequence: Number(e.target.value) })
                    }
                    required
                    sx={{ minWidth: 110 }}
                    inputProps={{ min: 1, max: 99 }}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Start"
                    type="date"
                    value={term.start_date}
                    onChange={(e) => patchTerm(term.key, { start_date: e.target.value })}
                    required
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="End"
                    type="date"
                    value={term.end_date}
                    onChange={(e) => patchTerm(term.key, { end_date: e.target.value })}
                    required
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={Boolean(
                      term.start_date && term.end_date && term.end_date <= term.start_date,
                    )}
                    helperText={
                      term.start_date && term.end_date && term.end_date <= term.start_date
                        ? 'Must be after the start date.'
                        : undefined
                    }
                  />
                </Stack>
              </Stack>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} onClick={addTermRow} sx={{ alignSelf: 'flex-start' }}>
            Add another term
          </Button>
        </Stack>
      </FormDialog>

      {/* Add / correct ONE term (D30 §D3) */}
      <TermFormDialog
        open={Boolean(termDialogYear)}
        term={termDialogTerm}
        yearName={termDialogYear?.name ?? ''}
        usedSequences={(termDialogYear?.semesters ?? []).map((t) => t.sequence)}
        submitting={createTermMut.isPending || updateTermMut.isPending}
        error={termError}
        fieldErrors={termFieldErrors}
        onSubmit={handleTermSubmit}
        onClose={closeTermDialog}
      />

      {/* Archive confirm */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive academic year?"
        destructive
        description={
          archiveTarget ? `Archive "${archiveTarget.name}"? This ends the active term.` : undefined
        }
        warning="Archiving freezes the year: grades and report cards are snapshotted and the year becomes read-only. This cannot be undone."
        confirmLabel="Archive year"
        pending={archiveMut.isPending}
        error={archiveError}
        onConfirm={handleArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </>
  );
}

export default AcademicStructureScreen;
