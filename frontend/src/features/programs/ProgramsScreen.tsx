import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  FormControlLabel,
  IconButton,
  Link as MuiLink,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  ConfirmDialog,
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import {
  useCreateProgram,
  useDeleteProgram,
  useProgramsList,
  useUpdateProgram,
} from './hooks/usePrograms';
import { ProgramFormDialog } from './components/ProgramFormDialog';
import type { ProgramListItem, ProgramWritePayload } from './types';

/**
 * The programmes / studies the college offers (D30 §D3) — Settings → Programmes.
 *
 * Dean-only to write (§D14, brief §6): what a programme REQUIRES is academic
 * structure, not administration. The Registrar reaches this screen — `programs:
 * 'view-all'` — but read-only, so the server's 403 is never something they can
 * trigger from the UI.
 *
 * The credits column shows CURRICULUM credits against the DECLARED total, because the
 * two can legitimately disagree while a sequence is being entered and the gap is the
 * useful signal: it is how a data-entry slip in an 87-credit sequence gets noticed.
 */
export function ProgramsScreen() {
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'programs') : false;
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [showRetired, setShowRetired] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      is_active: showRetired ? undefined : true,
      page: page + 1,
      page_size: pageSize,
      sort: 'code',
    }),
    [debouncedSearch, showRetired, page, pageSize],
  );

  const query = useProgramsList(params);
  const createMut = useCreateProgram();
  const updateMut = useUpdateProgram();
  const deleteMut = useDeleteProgram();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  const [deleteTarget, setDeleteTarget] = useState<ProgramListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (program: ProgramListItem) => {
    setEditing(program);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const handleSubmit = (values: ProgramWritePayload) => {
    setFormError(null);
    setFormFieldErrors({});
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editing) {
      updateMut.mutate(
        { id: editing.id, body: values },
        { onSuccess: () => setFormOpen(false), onError },
      );
    } else {
      createMut.mutate(values, { onSuccess: () => setFormOpen(false), onError });
    }
  };

  const toggleActive = (program: ProgramListItem) =>
    updateMut.mutate({ id: program.id, body: { is_active: !program.is_active } });

  const handleDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => setDeleteError(apiErrorMessage(err)),
    });
  };

  const openCurriculum = (id: string) => navigate(`${ROUTES.settings}/programs/${id}`);

  const columns: DataTableColumn<ProgramListItem>[] = [
    {
      field: 'code',
      headerName: 'Code',
      sortable: true,
      primary: true,
      render: (p) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => openCurriculum(p.id)}
          sx={{ fontWeight: 600, textAlign: 'left' }}
        >
          {p.code}
        </MuiLink>
      ),
    },
    {
      field: 'name',
      headerName: 'Programme',
      sortable: true,
      render: (p) => <Typography variant="body2">{p.name}</Typography>,
    },
    {
      field: 'award',
      headerName: 'Award',
      render: (p) =>
        p.award ?? (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
    {
      field: 'curriculum_credits',
      headerName: 'Credits',
      render: (p) => (
        <Typography
          variant="body2"
          // Amber while the entered curriculum does not yet add up to the declared
          // total — the honest state during data entry, and the one worth seeing.
          color={
            p.total_credits != null && p.curriculum_credits !== p.total_credits
              ? 'warning.main'
              : 'text.primary'
          }
        >
          {p.curriculum_credits}
          {p.total_credits != null ? ` / ${p.total_credits}` : ''}
        </Typography>
      ),
    },
    {
      field: 'course_count',
      headerName: 'Courses',
      render: (p) => <Typography variant="body2">{p.course_count}</Typography>,
    },
    {
      field: 'is_active',
      headerName: 'Status',
      render: (p) =>
        p.is_active ? (
          <StatusBadge label="Active" kind="success" />
        ) : (
          <StatusBadge label="Retired" kind="neutral" />
        ),
    },
  ];

  const rowActions = canManage
    ? (p: ProgramListItem) => (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {p.is_active ? (
            <Tooltip title="Retire">
              <IconButton
                size="small"
                aria-label={`Retire ${p.name}`}
                onClick={() => toggleActive(p)}
              >
                <ArchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Restore">
              <IconButton
                size="small"
                aria-label={`Restore ${p.name}`}
                onClick={() => toggleActive(p)}
              >
                <UnarchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Delete (only if no students are on it)">
            <IconButton
              size="small"
              color="error"
              aria-label={`Delete ${p.name}`}
              onClick={() => {
                setDeleteError(null);
                setDeleteTarget(p);
              }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )
    : undefined;

  return (
    <>
      <PageHeader
        title="Programmes"
        subtitle="The studies the college offers, and the course sequence each one requires."
        primaryAction={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              Add programme
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchPlaceholder="Search programmes…"
        trailing={
          <FormControlLabel
            control={
              <Switch
                checked={showRetired}
                onChange={(e) => {
                  setShowRetired(e.target.checked);
                  setPage(0);
                }}
              />
            }
            label="Show retired"
          />
        }
      />

      <DataTable<ProgramListItem>
        caption="Programmes"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(p) => p.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={page}
        pageSize={pageSize}
        total={query.data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(ps) => {
          setPageSize(ps);
          setPage(0);
        }}
        sortField="code"
        sortDirection="asc"
        emptyTitle={debouncedSearch ? 'No programmes match your search' : 'No programmes yet'}
        emptyDescription={
          canManage && !debouncedSearch
            ? 'Add a programme, then build its course sequence.'
            : undefined
        }
        emptyAction={
          canManage && !debouncedSearch
            ? { label: 'Add programme', onClick: openCreate }
            : undefined
        }
        rowActions={rowActions}
      />

      <ProgramFormDialog
        open={formOpen}
        program={editing}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete programme?"
        destructive
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.name}"? This can only be done while no student is registered on it. If students are, retire it instead — that stops new enrolments without touching anyone's record.`
            : undefined
        }
        confirmLabel="Delete"
        pending={deleteMut.isPending}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default ProgramsScreen;
