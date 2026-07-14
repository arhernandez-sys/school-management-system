import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
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
} from '../hooks/useSettings';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import type { AcademicYearDetail } from '@shared/api/generated/model';

/**
 * Academic structure (api-spec §11, D10). Lists academic years with their two
 * semesters. Principal/Secretary can:
 *  - Create a year with EXACTLY two semesters (D10) — 409 active_year_exists surfaced.
 *  - Activate a semester — conflicts surfaced.
 *  - Archive a year (confirm dialog warns it freezes the year) — 202 accepted;
 *    409 year_already_archived surfaced.
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

  // ── create-year dialog ──────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [yearName, setYearName] = useState('');
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');
  const [s1Name, setS1Name] = useState('Semester 1');
  const [s1Start, setS1Start] = useState('');
  const [s1End, setS1End] = useState('');
  const [s2Name, setS2Name] = useState('Semester 2');
  const [s2Start, setS2Start] = useState('');
  const [s2End, setS2End] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({});

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
    setS1Name('Semester 1');
    setS1Start('');
    setS1End('');
    setS2Name('Semester 2');
    setS2Start('');
    setS2End('');
    setCreateError(null);
    setCreateFieldErrors({});
  };

  const openCreate = () => {
    resetCreateForm();
    setCreateOpen(true);
  };

  const createValid = Boolean(
    yearName.trim() &&
      yearStart &&
      yearEnd &&
      s1Name.trim() &&
      s1Start &&
      s1End &&
      s2Name.trim() &&
      s2Start &&
      s2End,
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
          semesters: [
            { name: s1Name.trim(), sequence: 1, start_date: s1Start, end_date: s1End },
            { name: s2Name.trim(), sequence: 2, start_date: s2Start, end_date: s2End },
          ],
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
        subtitle="Academic years and their semesters. A year always has exactly two semesters."
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
                          {canManage && !isArchived && !sem.is_active && (
                            <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                              <Button
                                size="small"
                                onClick={() => handleActivate(sem.id)}
                                disabled={activateMut.isPending}
                              >
                                Activate
                              </Button>
                            </CardActions>
                          )}
                        </Card>
                      ))}
                    </Stack>
                  ) : (
                    <Table size="small" aria-label={`Semesters for ${year.name}`}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Semester</TableCell>
                          <TableCell>Dates</TableCell>
                          <TableCell>Status</TableCell>
                          {canManage && !isArchived && <TableCell align="right" />}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {year.semesters.map((sem) => (
                          <TableRow key={sem.id}>
                            <TableCell>{sem.name}</TableCell>
                            <TableCell>
                              {sem.start_date} → {sem.end_date}
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

          <Divider>Semester 1</Divider>
          <TextField
            label="Semester 1 name"
            value={s1Name}
            onChange={(e) => setS1Name(e.target.value)}
            required
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Start"
              type="date"
              value={s1Start}
              onChange={(e) => setS1Start(e.target.value)}
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End"
              type="date"
              value={s1End}
              onChange={(e) => setS1End(e.target.value)}
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          <Divider>Semester 2</Divider>
          <TextField
            label="Semester 2 name"
            value={s2Name}
            onChange={(e) => setS2Name(e.target.value)}
            required
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Start"
              type="date"
              value={s2Start}
              onChange={(e) => setS2Start(e.target.value)}
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End"
              type="date"
              value={s2End}
              onChange={(e) => setS2End(e.target.value)}
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </Stack>
      </FormDialog>

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
