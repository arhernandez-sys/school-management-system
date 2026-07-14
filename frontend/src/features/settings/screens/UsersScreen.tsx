import { useMemo, useState } from 'react';
import { Button, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import LockResetIcon from '@mui/icons-material/LockReset';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  RoleChip,
  ConfirmDialog,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { Role } from '@shared/api/generated/model';
import type { UserListItem } from '@shared/api/generated/model';
import {
  useUsersList,
  useCreateUser,
  useUpdateUser,
  useResetUserPassword,
} from '../hooks/useSettings';
import { UserFormDialog, type UserFormValues } from '../components/UserFormDialog';
import { TempPasswordDialog } from '../components/TempPasswordDialog';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';

/**
 * Users administration (api-spec §11). Principal + Secretary list/create/edit and
 * trigger password resets. Privilege rules are mirrored in the UX (only a principal
 * may set role / is_active) but the SERVER is authoritative — a 403 role_change_forbidden
 * and 409 duplicate_email are surfaced in the form. Reset triggers the existing
 * POST /auth/users/{id}/reset-password and shows the one-time temp password.
 */
export function UsersScreen() {
  const { user } = useAuth();
  const isPrincipal = user?.role === 'principal';

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      role: roleFilter || undefined,
      is_active: activeFilter === 'all' ? undefined : activeFilter === 'active',
      page: page + 1,
      page_size: pageSize,
      sort: 'full_name',
    }),
    [debouncedSearch, roleFilter, activeFilter, page, pageSize],
  );

  const query = useUsersList(params);
  const createMut = useCreateUser();
  const updateMut = useUpdateUser();
  const resetMut = useResetUserPassword();

  // ── form dialog ──────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  // ── temp password reveal (create-generated or reset) ──────────────────────────
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempSubject, setTempSubject] = useState<string | undefined>(undefined);

  // ── reset confirm ──────────────────────────────────────────────────────────────
  const [resetTarget, setResetTarget] = useState<UserListItem | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };
  const openEdit = (u: UserListItem) => {
    setEditing(u);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const handleFormSubmit = (values: UserFormValues) => {
    setFormError(null);
    setFormFieldErrors({});
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editing) {
      // Only send privileged fields when the actor may change them.
      const data = {
        full_name: values.full_name,
        username: values.username || null,
        ...(isPrincipal ? { role: values.role, is_active: values.is_active } : {}),
      };
      updateMut.mutate({ userId: editing.id, data }, { onSuccess: () => setFormOpen(false), onError });
    } else {
      createMut.mutate(
        {
          data: {
            email: values.email,
            username: values.username || null,
            full_name: values.full_name,
            role: values.role,
            temporary_password: values.temporary_password || null,
          },
        },
        {
          onSuccess: (res) => {
            setFormOpen(false);
            if (res.temporary_password) {
              setTempSubject(res.user.email);
              setTempPassword(res.temporary_password);
            }
          },
          onError,
        },
      );
    }
  };

  const handleReset = () => {
    if (!resetTarget) return;
    setResetError(null);
    resetMut.mutate(
      { userId: resetTarget.id, data: {} },
      {
        onSuccess: (res) => {
          setTempSubject(resetTarget.email);
          setResetTarget(null);
          setTempPassword(res.temporary_password);
        },
        onError: (err) => setResetError(apiErrorMessage(err)),
      },
    );
  };

  const columns: DataTableColumn<UserListItem>[] = [
    {
      field: 'full_name',
      headerName: 'Name',
      sortable: true,
      primary: true,
      render: (u) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {u.full_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {u.email}
          </Typography>
        </>
      ),
    },
    { field: 'role', headerName: 'Role', render: (u) => <RoleChip role={u.role} /> },
    {
      field: 'is_active',
      headerName: 'Status',
      render: (u) =>
        u.is_active ? (
          <StatusBadge label="Active" kind="success" />
        ) : (
          <StatusBadge label="Inactive" kind="neutral" />
        ),
    },
    {
      field: 'must_change_password',
      headerName: 'Password',
      hideOnMobile: true,
      render: (u) =>
        u.must_change_password ? <StatusBadge label="Reset pending" kind="warning" /> : '—',
    },
  ];

  const rowActions = (u: UserListItem) => (
    <>
      <Tooltip title="Edit">
        <IconButton size="small" aria-label={`Edit ${u.full_name}`} onClick={() => openEdit(u)}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reset password">
        <IconButton
          size="small"
          aria-label={`Reset password for ${u.full_name}`}
          onClick={() => {
            setResetError(null);
            setResetTarget(u);
          }}
        >
          <LockResetIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  );

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Staff and student accounts."
        primaryAction={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add user
          </Button>
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchPlaceholder="Search name or email…"
        filters={
          <>
            <TextField
              select
              label="Role"
              size="small"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as Role | '');
                setPage(0);
              }}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">All roles</MenuItem>
              <MenuItem value={Role.principal}>Principal</MenuItem>
              <MenuItem value={Role.secretary}>Secretary</MenuItem>
              <MenuItem value={Role.teacher}>Teacher</MenuItem>
              <MenuItem value={Role.student}>Student</MenuItem>
            </TextField>
            <TextField
              select
              label="Status"
              size="small"
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value as 'all' | 'active' | 'inactive');
                setPage(0);
              }}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          </>
        }
      />

      <DataTable<UserListItem>
        caption="User accounts"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(u) => u.id}
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
        sortField="full_name"
        sortDirection="asc"
        emptyTitle="No users match your filters"
        rowActions={rowActions}
      />

      <UserFormDialog
        open={formOpen}
        user={editing}
        canManagePrivileges={Boolean(isPrincipal)}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(resetTarget)}
        title="Reset password?"
        description={
          resetTarget
            ? `Generate a new temporary password for ${resetTarget.full_name}? Their current password will stop working and they must set a new one at next sign-in.`
            : undefined
        }
        confirmLabel="Reset password"
        pending={resetMut.isPending}
        error={resetError}
        onConfirm={handleReset}
        onCancel={() => setResetTarget(null)}
      />

      <TempPasswordDialog
        open={Boolean(tempPassword)}
        password={tempPassword}
        subject={tempSubject}
        onClose={() => setTempPassword(null)}
      />
    </>
  );
}

export default UsersScreen;
