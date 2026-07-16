import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { TempPasswordDialog } from '@features/settings/components/TempPasswordDialog';
import { useDebounce, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useCreateTeacher, useTeachersList } from './hooks/useTeachers';
import { TeacherFormDialog, type TeacherFormValues } from './components/TeacherFormDialog';
import type { TeacherListItem, TeachersListParams } from './types';
import type { TeacherStatus } from '@shared/types/enums';

/**
 * Teachers directory (api-spec §5.4 GET /teachers). A searchable, filterable, paginated
 * list of staff — rows link to the teacher detail. Principal / secretary can add a
 * teacher (with an optional linked login); teacher/other roles see the directory
 * read-only (the route is role-guarded upstream). Scope is server-enforced.
 */
export function TeachersListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'teachers') : false;

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [status, setStatus] = useState<TeacherStatus | ''>('');
  const [specialization, setSpecialization] = useState('');
  const debouncedSpec = useDebounce(specialization, 300);
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempSubject, setTempSubject] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const params = useMemo<TeachersListParams>(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      specialization: debouncedSpec || undefined,
      academic_year_id: yearId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: 'full_name',
    }),
    [debouncedSearch, status, debouncedSpec, yearId, page, pageSize],
  );

  const query = useTeachersList(params);
  const createMut = useCreateTeacher();

  const goToTeacher = (id: string) => navigate(`${ROUTES.teachers}/${id}`);

  const handleCreate = (values: TeacherFormValues) => {
    setFormError(null);
    setFieldErrors(undefined);
    createMut.mutate(
      {
        staff_number: values.staff_number,
        full_name: values.full_name,
        email: values.email || null,
        phone: values.phone || null,
        subject_specializations: values.subject_specializations,
        create_login: values.create_login
          ? { email: values.login_email, role: 'teacher' }
          : null,
      },
      {
        onSuccess: (result) => {
          setCreateOpen(false);
          if (result.temporary_password) {
            setTempPassword(result.temporary_password);
            setTempSubject(result.teacher.full_name);
          } else {
            setToast(`${result.teacher.full_name} was added.`);
          }
        },
        onError: (err) => {
          setFormError(apiErrorMessage(err));
          setFieldErrors(fieldErrorsFrom(err));
        },
      },
    );
  };

  const columns: DataTableColumn<TeacherListItem>[] = [
    {
      field: 'full_name',
      headerName: 'Name',
      sortable: true,
      primary: true,
      render: (t) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => goToTeacher(t.id)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {t.full_name}
        </MuiLink>
      ),
    },
    {
      field: 'staff_number',
      headerName: 'Staff #',
      sortable: true,
      render: (t) => <Typography variant="body2">{t.staff_number}</Typography>,
    },
    {
      field: 'subject_specializations',
      headerName: 'Specializations',
      render: (t) =>
        t.subject_specializations.length > 0 ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {t.subject_specializations.map((s) => (
              <Chip key={s} label={s} size="small" variant="outlined" />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        ),
    },
    {
      field: 'assignment_count',
      headerName: 'Assignments',
      align: 'right',
      render: (t) => <Typography variant="body2">{t.assignment_count}</Typography>,
    },
    {
      field: 'status',
      headerName: 'Status',
      render: (t) =>
        t.status === 'active' ? (
          <StatusBadge label="Active" kind="success" />
        ) : (
          <StatusBadge label="Inactive" kind="neutral" />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Teachers"
        subtitle="Teaching staff, their subject specializations, and class assignments."
        primaryAction={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<PersonAddAlt1Icon />}
              onClick={() => {
                setFormError(null);
                setFieldErrors(undefined);
                setCreateOpen(true);
              }}
            >
              Add teacher
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
        searchPlaceholder="Search by name or staff #…"
        filters={
          <>
            <YearSelect
              value={yearId}
              onChange={(id) => {
                setYearId(id);
                setPage(0);
              }}
              years={years}
              activeYearId={activeYearId}
              isLoading={yearsLoading}
            />
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as TeacherStatus | '');
                setPage(0);
              }}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Specialization"
              value={specialization}
              onChange={(e) => {
                setSpecialization(e.target.value);
                setPage(0);
              }}
              placeholder="e.g. Mathematics"
              sx={{ minWidth: 180 }}
            />
          </>
        }
      />

      <DataTable<TeacherListItem>
        caption="Teachers directory"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(t) => t.id}
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
        emptyTitle={
          debouncedSearch || status || debouncedSpec
            ? 'No teachers match your filters'
            : 'No teachers yet'
        }
        emptyDescription={
          debouncedSearch || status || debouncedSpec
            ? 'Try adjusting your search or filters.'
            : 'Teachers will appear here once added.'
        }
      />

      {canManage && (
        <TeacherFormDialog
          open={createOpen}
          submitting={createMut.isPending}
          error={formError}
          fieldErrors={fieldErrors}
          onSubmit={handleCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}

      <TempPasswordDialog
        open={Boolean(tempPassword)}
        password={tempPassword}
        subject={tempSubject}
        onClose={() => {
          setTempPassword(null);
          setTempSubject(undefined);
        }}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity="success" onClose={() => setToast(null)} variant="filled">
            {toast}
          </Alert>
        ) : (
          <Box />
        )}
      </Snackbar>
    </>
  );
}

export default TeachersListPage;
