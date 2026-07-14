import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  MenuItem,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
  type StatusKind,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useCreateStudent, useStudentsList } from './hooks/useStudents';
import { useSectionOptions } from './hooks/useSections';
import { StudentFormDialog } from './components/StudentFormDialog';
import type { StudentListItem, StudentWritePayload, StudentsListParams } from './types';
import type { StudentStatus } from '@shared/types/enums';

const STATUS_KIND: Record<StudentStatus, StatusKind> = {
  active: 'success',
  inactive: 'neutral',
  transferred: 'info',
  graduated: 'info',
  withdrawn: 'neutral',
};

const STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  transferred: 'Transferred',
  graduated: 'Graduated',
  withdrawn: 'Withdrawn',
};

/**
 * Students directory (api-spec §5.3 GET /students). A searchable, filterable, paginated
 * list — rows link to the student detail. Principal / secretary can add a student.
 * Scope is server-enforced: a teacher sees only students in sections they teach; the
 * route is role-guarded upstream (a student uses "My Profile" instead).
 */
export function StudentsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'students') : false;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [status, setStatus] = useState<StudentStatus | ''>('');
  const [sectionId, setSectionId] = useState('');
  const [sortField, setSortField] = useState('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const sectionsQuery = useSectionOptions();
  const sections = sectionsQuery.data ?? [];

  const params = useMemo<StudentsListParams>(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      class_id: sectionId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: sortDirection === 'desc' ? `-${sortField}` : sortField,
    }),
    [debouncedSearch, status, sectionId, page, pageSize, sortField, sortDirection],
  );

  const query = useStudentsList(params);
  const createMut = useCreateStudent();

  const goToStudent = (id: string) => navigate(`${ROUTES.students}/${id}`);

  const handleCreate = (values: StudentWritePayload) => {
    setFormError(null);
    setFieldErrors(undefined);
    createMut.mutate(values, {
      onSuccess: (created) => {
        setCreateOpen(false);
        setToast(`${created.full_name} was added.`);
      },
      onError: (err) => {
        setFormError(apiErrorMessage(err));
        setFieldErrors(fieldErrorsFrom(err));
      },
    });
  };

  const hasFilters = Boolean(debouncedSearch || status || sectionId);

  const columns: DataTableColumn<StudentListItem>[] = [
    {
      field: 'full_name',
      headerName: 'Name',
      sortable: true,
      primary: true,
      render: (s) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => goToStudent(s.id)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {s.full_name}
        </MuiLink>
      ),
    },
    {
      field: 'student_number',
      headerName: 'Student #',
      sortable: true,
      render: (s) => <Typography variant="body2">{s.student_number}</Typography>,
    },
    {
      field: 'section',
      headerName: 'Section',
      render: (s) => (
        <Typography variant="body2">{s.current_section?.name ?? '—'}</Typography>
      ),
    },
    {
      field: 'grade_level',
      headerName: 'Grade',
      hideOnMobile: true,
      render: (s) => (
        <Typography variant="body2">{s.current_section?.grade_level ?? '—'}</Typography>
      ),
    },
    {
      field: 'guardian_name',
      headerName: 'Guardian',
      render: (s) => <Typography variant="body2">{s.guardian_name || '—'}</Typography>,
    },
    {
      field: 'status',
      headerName: 'Status',
      render: (s) => <StatusBadge label={STATUS_LABEL[s.status]} kind={STATUS_KIND[s.status]} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Enrolled students, their section, and guardian contact."
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
              Add student
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
        searchPlaceholder="Search by name or student #…"
        filters={
          <>
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as StudentStatus | '');
                setPage(0);
              }}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {(Object.keys(STATUS_LABEL) as StudentStatus[]).map((st) => (
                <MenuItem key={st} value={st}>
                  {STATUS_LABEL[st]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Section"
              value={sectionId}
              onChange={(e) => {
                setSectionId(e.target.value);
                setPage(0);
              }}
              disabled={sectionsQuery.isLoading}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">All sections</MenuItem>
              {sections.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          </>
        }
      />

      <DataTable<StudentListItem>
        caption="Students directory"
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
        sortField={sortField}
        sortDirection={sortDirection}
        onSortChange={(field, direction) => {
          setSortField(field);
          setSortDirection(direction);
          setPage(0);
        }}
        emptyTitle={hasFilters ? 'No students match your filters' : 'No students yet'}
        emptyDescription={
          hasFilters
            ? 'Try adjusting your search or filters.'
            : 'Students will appear here once added.'
        }
      />

      {canManage && (
        <StudentFormDialog
          open={createOpen}
          submitting={createMut.isPending}
          error={formError}
          fieldErrors={fieldErrors}
          onSubmit={handleCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}

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

export default StudentsListPage;
