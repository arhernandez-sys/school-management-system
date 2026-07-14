import { useMemo, useState } from 'react';
import { Button, FormControlLabel, IconButton, Switch, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  ConfirmDialog,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import type { SubjectListItem } from '@shared/api/generated/model';
import {
  useSubjectsList,
  useCreateSubject,
  useUpdateSubject,
  useDeleteSubject,
} from './hooks/useSubjects';
import { SubjectFormDialog, type SubjectFormValues } from './components/SubjectFormDialog';

/**
 * Subjects catalog (api-spec §5b, ui-design-system Settings). Principal/Secretary
 * manage; the list defaults to active subjects and can reveal retired ones. CRUD:
 *  - Create / edit via SubjectFormDialog (409 duplicate_subject_name/code surfaced inline).
 *  - Retire (soft) = PATCH is_active:false; Restore = PATCH is_active:true.
 *  - Delete (hard) allowed only when unused; 409 subject_in_use is surfaced and the
 *    user is steered to retire instead.
 *
 * Management controls are hidden for non-P/S roles (UX only; the server enforces).
 */
export function SubjectsPage() {
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'settings') : false;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [showRetired, setShowRetired] = useState(false);
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      // Default (active-only) is the backend default when `is_active` is omitted.
      // "Show retired" lists ALL subjects (active + retired) by omitting the filter.
      is_active: showRetired ? undefined : true,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: 'name',
    }),
    [debouncedSearch, showRetired, page, pageSize],
  );

  const query = useSubjectsList(params);
  const createMut = useCreateSubject();
  const updateMut = useUpdateSubject();
  const deleteMut = useDeleteSubject();

  // ── dialog state ───────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  const [deleteTarget, setDeleteTarget] = useState<SubjectListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingSubject(null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (subject: SubjectListItem) => {
    setEditingSubject(subject);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const handleFormSubmit = (values: SubjectFormValues) => {
    setFormError(null);
    setFormFieldErrors({});
    const body = { name: values.name, code: values.code || null };
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editingSubject) {
      updateMut.mutate(
        { subjectId: editingSubject.id, data: body },
        { onSuccess: () => setFormOpen(false), onError },
      );
    } else {
      createMut.mutate({ data: body }, { onSuccess: () => setFormOpen(false), onError });
    }
  };

  const handleToggleActive = (subject: SubjectListItem) => {
    updateMut.mutate({ subjectId: subject.id, data: { is_active: !subject.is_active } });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMut.mutate(
      { subjectId: deleteTarget.id },
      {
        onSuccess: () => setDeleteTarget(null),
        onError: (err) => setDeleteError(apiErrorMessage(err)),
      },
    );
  };

  const columns: DataTableColumn<SubjectListItem>[] = [
    {
      field: 'name',
      headerName: 'Subject',
      sortable: true,
      primary: true,
      render: (s) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {s.name}
        </Typography>
      ),
    },
    {
      field: 'code',
      headerName: 'Code',
      render: (s) =>
        s.code ?? (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
    {
      field: 'is_active',
      headerName: 'Status',
      render: (s) =>
        s.is_active ? (
          <StatusBadge label="Active" kind="success" />
        ) : (
          <StatusBadge label="Retired" kind="neutral" />
        ),
    },
  ];

  const rowActions = canManage
    ? (s: SubjectListItem) => (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {s.is_active ? (
            <Tooltip title="Retire">
              <IconButton
                size="small"
                aria-label={`Retire ${s.name}`}
                onClick={() => handleToggleActive(s)}
              >
                <ArchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Restore">
              <IconButton
                size="small"
                aria-label={`Restore ${s.name}`}
                onClick={() => handleToggleActive(s)}
              >
                <UnarchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Delete (only if unused)">
            <IconButton
              size="small"
              color="error"
              aria-label={`Delete ${s.name}`}
              onClick={() => {
                setDeleteError(null);
                setDeleteTarget(s);
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
        title="Subjects"
        subtitle="Manage the catalog of subjects taught across the school."
        primaryAction={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              Add subject
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
        searchPlaceholder="Search subjects…"
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

      <DataTable<SubjectListItem>
        caption="Subjects catalog"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(s) => s.id}
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
        sortField="name"
        sortDirection="asc"
        emptyTitle={debouncedSearch ? 'No subjects match your search' : 'No subjects yet'}
        emptyDescription={
          canManage && !debouncedSearch ? 'Add your first subject to get started.' : undefined
        }
        emptyAction={
          canManage && !debouncedSearch ? { label: 'Add subject', onClick: openCreate } : undefined
        }
        rowActions={rowActions}
      />

      <SubjectFormDialog
        open={formOpen}
        subject={editingSubject}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete subject?"
        destructive
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.name}"? This can only be done if the subject is not used by any class. If it is in use, retire it instead.`
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

export default SubjectsPage;
