import { useMemo, useState } from 'react';
import { Button, IconButton, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
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
import {
  useClassroomsList,
  useCreateClassroom,
  useUpdateClassroom,
  useDeleteClassroom,
} from './hooks/useClassrooms';
import { ClassroomFormDialog } from './components/ClassroomFormDialog';
import { CLASSROOM_STATUS_LABEL, type ClassroomListItem } from './types';

/**
 * Classrooms (D44) — the college's physical rooms, from the client's `sims_10` dump.
 *
 * Lives in Settings rather than the main menu, unlike the catalog that just left it: a
 * room list is estate administration, edited when a building changes, not something anyone
 * opens during a teaching week. Dean and Registrar write; everyone else reads.
 *
 * DELETE IS HARD, and refused while a room is in use — a room carries no history worth
 * keeping, but the FK is `ON DELETE SET NULL`, so deleting a booked room would quietly
 * unroom every class in it. The server answers 409 `classroom_in_use`; the confirm dialog
 * below says so before anyone gets there, and points at Inactive instead.
 */
export function ClassroomsScreen() {
  const { user } = useAuth();
  // The catalog and rooms are both administered by the same pair; `settings` is the
  // capability that already means "Dean or Registrar" here.
  const canManage = user ? canWrite(user.role, 'settings') : false;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClassroomListItem | null>(null);
  const [deleting, setDeleting] = useState<ClassroomListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const listQuery = useClassroomsList({
    page: page + 1,
    page_size: pageSize,
    search: debouncedSearch || undefined,
  });
  const createMut = useCreateClassroom();
  const updateMut = useUpdateClassroom();
  const deleteMut = useDeleteClassroom();

  const rows = listQuery.data?.items ?? [];

  const columns = useMemo<DataTableColumn<ClassroomListItem>[]>(
    () => [
      {
        field: 'room_code',
        headerName: 'Room',
        primary: true,
        render: (r) => (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {r.room_code}
          </Typography>
        ),
      },
      { field: 'building', headerName: 'Building', render: (r) => r.building },
      {
        field: 'room_type',
        headerName: 'Type',
        hideOnMobile: true,
        render: (r) =>
          r.room_type ?? (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: 'capacity',
        headerName: 'Seats',
        align: 'right',
        // 0 means "not recorded", which is a different thing from a room with no chairs.
        render: (r) =>
          r.capacity > 0 ? (
            r.capacity
          ) : (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: 'offering_count',
        headerName: 'Offerings',
        align: 'right',
        hideOnMobile: true,
        render: (r) => r.offering_count,
      },
      {
        field: 'status',
        headerName: 'Status',
        render: (r) => (
          <StatusBadge
            label={CLASSROOM_STATUS_LABEL[r.status]}
            kind={r.status === 'Active' ? 'success' : r.status === 'Inactive' ? 'neutral' : 'info'}
          />
        ),
      },
    ],
    [],
  );

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setError(null);
    setFieldErrors({});
  };

  const onFormError = (err: unknown) => {
    setError(apiErrorMessage(err));
    setFieldErrors(fieldErrorsFrom(err) ?? {});
  };

  return (
    <>
      <PageHeader
        title="Classrooms"
        subtitle="The rooms courses are scheduled into"
        primaryAction={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add classroom
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        searchPlaceholder="Search code, building or type"
        searchLabel="Search classrooms"
      />

      <DataTable<ClassroomListItem>
        caption="Classrooms, ordered by building then room code"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        page={page}
        pageSize={pageSize}
        total={listQuery.data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(ps) => {
          setPageSize(ps);
          setPage(0);
        }}
        emptyTitle="No classrooms yet"
        emptyDescription="Add the rooms courses are taught in, so an offering can be scheduled into one."
        emptyAction={
          canManage
            ? { label: 'Add classroom', onClick: () => setFormOpen(true) }
            : undefined
        }
        rowActions={
          canManage
            ? (row) => (
                <>
                  <Tooltip title="Edit classroom">
                    <IconButton
                      size="small"
                      aria-label={`Edit ${row.label}`}
                      onClick={() => {
                        setEditing(row);
                        setFormOpen(true);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete classroom">
                    <IconButton
                      size="small"
                      aria-label={`Delete ${row.label}`}
                      onClick={() => setDeleting(row)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )
            : undefined
        }
      />

      <ClassroomFormDialog
        open={formOpen}
        classroom={editing}
        submitting={createMut.isPending || updateMut.isPending}
        error={error}
        fieldErrors={fieldErrors}
        onClose={closeForm}
        onSubmit={(values) => {
          setError(null);
          setFieldErrors({});
          if (editing) {
            updateMut.mutate(
              { id: editing.id, body: values },
              { onSuccess: closeForm, onError: onFormError },
            );
          } else {
            createMut.mutate(values, { onSuccess: closeForm, onError: onFormError });
          }
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.label ?? 'this classroom'}?`}
        description="This cannot be undone. A room that has simply closed is better set Inactive, which keeps it on the list."
        // The 409 is knowable before the request, so it is said here rather than after.
        warning={
          deleting && deleting.offering_count > 0
            ? `${deleting.label} is assigned to ${deleting.offering_count} course offering${
                deleting.offering_count === 1 ? '' : 's'
              }. The server will refuse the delete — reassign them first, or set the room Inactive.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        pending={deleteMut.isPending}
        error={error}
        onCancel={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={() => {
          if (!deleting) return;
          deleteMut.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            // Kept OPEN on failure: the dialog is where the error renders, and closing
            // it would drop the explanation the user needs.
            onError: (err) => setError(apiErrorMessage(err)),
          });
        }}
      />
    </>
  );
}

export default ClassroomsScreen;
