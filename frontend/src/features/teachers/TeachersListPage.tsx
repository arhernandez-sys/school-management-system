import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Chip,
  Link as MuiLink,
  MenuItem,
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
import { useDebounce, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';
import { strings } from '@i18n/strings';
import { useTeachersList } from './hooks/useTeachers';
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

  const goToTeacher = (id: string) => navigate(`${ROUTES.teachers}/${id}`);

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
        title={strings.terms.lecturers}
        subtitle="Teaching staff, their subject specializations, and class assignments."
        primaryAction={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<PersonAddAlt1Icon />}
              // D40 — a page, not a modal. The lecturer record is ~20 fields and the
              // create form now shows all of them; see `TeacherFormScreen`.
              onClick={() => navigate(`${ROUTES.teachers}/new`)}
            >
              Add Lecturer
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
        caption="Lecturers directory"
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
            ? 'No lecturers match your filters'
            : 'No lecturers yet'
        }
        emptyDescription={
          debouncedSearch || status || debouncedSpec
            ? 'Try adjusting your search or filters.'
            : 'Lecturers will appear here once added.'
        }
      />

      {/* D40 — the create dialog, its temp-password dialog and this page's success
          toast all moved to `TeacherFormScreen`, which is where the create now happens.
          The one-time password especially: it is shown ONCE and never again, so it has to
          belong to the screen that provisions the login rather than to a list this page
          would have navigated away from. */}
    </>
  );
}

export default TeachersListPage;
