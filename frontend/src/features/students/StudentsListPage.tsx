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
  YearSelect,
  type DataTableColumn,
  type StatusKind,
} from '@shared/components';
import { useDebounce, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { strings } from '@i18n/strings';
import { useCreateStudent, useStudentsList } from './hooks/useStudents';
import { useOfferingOptions, YEAR_OF_STUDY_OPTIONS } from './hooks/useOfferingOptions';
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

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [status, setStatus] = useState<StudentStatus | ''>('');
  const [offeringId, setOfferingId] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState('');
  // D30 §D10: the register is ordered by SURNAME then given name. `last_name` is the
  // API's spelling of that composite ordering — it is not a single-column sort.
  const [sortField, setSortField] = useState('last_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const offeringsQuery = useOfferingOptions();
  const offerings = offeringsQuery.data ?? [];

  const params = useMemo<StudentsListParams>(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      offering_id: offeringId || undefined,
      // Filters on the student's OWN level, not on anything derived from what they take.
      year_of_study: yearOfStudy || undefined,
      academic_year_id: yearId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: sortDirection === 'desc' ? `-${sortField}` : sortField,
    }),
    [
      debouncedSearch,
      status,
      offeringId,
      yearOfStudy,
      yearId,
      page,
      pageSize,
      sortField,
      sortDirection,
    ],
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

  const hasFilters = Boolean(debouncedSearch || status || offeringId || yearOfStudy);

  const columns: DataTableColumn<StudentListItem>[] = [
    {
      // Sorting this column asks for `last_name`, which the API expands to
      // (last_name, first_name) — the display string is never the sort key (D30 §D10).
      field: 'last_name',
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
      // The student's OWN level (D29 replaced the homeroom name; D30 renamed the field to
      // `year_of_study` and made it an enum). The offerings they take are a variable-length
      // list that belongs on the profile, not in a table cell — the count is what is
      // scannable here, and the course filter above narrows by a specific one.
      field: 'year_of_study',
      headerName: 'Year',
      sortable: true,
      render: (s) => <Typography variant="body2">{s.year_of_study || '—'}</Typography>,
    },
    {
      field: 'offering_count',
      headerName: 'Courses',
      align: 'right',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.offering_count}</Typography>,
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
              label="Year"
              value={yearOfStudy}
              onChange={(e) => {
                setYearOfStudy(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 150 }}
            >
              {/* Two fixed values, not a derived list — `year_of_study` is a server-side
                  enum, so there is nothing to discover from the directory. */}
              <MenuItem value="">All years</MenuItem>
              {YEAR_OF_STUDY_OPTIONS.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={strings.terms.courseOffering}
              value={offeringId}
              onChange={(e) => {
                setOfferingId(e.target.value);
                setPage(0);
              }}
              disabled={offeringsQuery.isLoading}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">All offerings</MenuItem>
              {offerings.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.course_name ? `${o.label} — ${o.course_name}` : o.label}
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
