import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce, useYearFilter } from '@shared/hooks';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useSubjectsList } from '@features/settings/hooks/useSubjects';
import { useClassesList, useCreateClass } from './hooks/useClasses';
import { ClassFormDialog } from './components/ClassFormDialog';
import { roomsOf, summarizeMeetings } from './meetingFormat';
import type { ClassCreateBody, ClassListItem } from './types';

/**
 * Subject-class list (api-spec §5 GET /classes, ui-design-system §7.5).
 *
 * **D29** — a row is one SUBJECT CLASS ("Math-1"): one subject, its teacher(s), its weekly
 * slot, its own roster. Two Math classes are two rows, and a student can be enrolled in
 * several rows at once. This is why the table leads with Class · Subject · Teacher ·
 * When/Where instead of the old Class · Grade · Subjects count: "how many subjects does
 * this homeroom teach" is no longer a meaningful question (the answer is always 1).
 *
 * The API returns subject/teachers/meetings ON the list row, so none of those columns cost
 * a follow-up request.
 *
 * Capacity shows as `enrolled/capacity`; over-capacity surfaces a warn-only "Over capacity"
 * chip (D-Q6) — it never blocks. Scope is server-enforced (P/S = all, Teacher = classes they
 * teach, Student = classes they are enrolled in); this screen renders what the API returns.
 */
export function ClassesListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const canManage = user ? canWrite(user.role, 'classes') : false;

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [subjectId, setSubjectId] = useState('');
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);
  // The subject filter is a staff tool ("show me both Math classes"). A student sees only
  // their own handful of classes, so the picker would be noise — and it is their own
  // subject list, which the timetable already presents better.
  const showSubjectFilter = canManage;
  const subjectsQuery = useSubjectsList({ page: 1, page_size: 200, sort: 'name' });
  const subjectOptions = subjectsQuery.data?.items ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      academic_year_id: yearId || undefined,
      subject_id: subjectId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: 'name',
    }),
    [debouncedSearch, yearId, subjectId, page, pageSize],
  );

  const query = useClassesList(params);
  const createMut = useCreateClass();

  const goToClass = (id: string) => navigate(`${ROUTES.classes}/${id}`);

  const handleCreate = (values: ClassCreateBody) => {
    setFormError(null);
    setFieldErrors(undefined);
    createMut.mutate(values, {
      onSuccess: (created) => {
        setCreateOpen(false);
        setToast(`${created.name} was added.`);
      },
      onError: (err) => {
        setFormError(apiErrorMessage(err));
        setFieldErrors(fieldErrorsFrom(err));
      },
    });
  };

  const columns: DataTableColumn<ClassListItem>[] = [
    {
      field: 'name',
      headerName: 'Class',
      sortable: true,
      primary: true,
      render: (c) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => goToClass(c.id)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {c.name}
        </MuiLink>
      ),
    },
    {
      field: 'subject',
      headerName: 'Subject',
      render: (c) =>
        c.subject ? (
          <Stack spacing={0.25}>
            <Typography variant="body2">{c.subject.name}</Typography>
            {c.subject.code && (
              <Typography variant="caption" color="text.secondary">
                {c.subject.code}
              </Typography>
            )}
          </Stack>
        ) : (
          // Only reachable for a pre-D29 row that never had a subject attached. Such a
          // class cannot be graded or scheduled, so it is flagged rather than blanked.
          <StatusBadge label="No subject" kind="warning" />
        ),
    },
    {
      field: 'teachers',
      headerName: 'Teacher',
      render: (c) =>
        c.teachers.length > 0 ? (
          <Typography variant="body2">{c.teachers.map((t) => t.full_name).join(', ')}</Typography>
        ) : (
          <StatusBadge label="Not assigned" kind="neutral" />
        ),
    },
    {
      field: 'meetings',
      headerName: 'When / where',
      render: (c) => {
        const when = summarizeMeetings(c.meetings);
        const rooms = roomsOf(c.meetings);
        if (!when) return <StatusBadge label="Not scheduled" kind="neutral" />;
        return (
          <Stack spacing={0.25}>
            <Typography variant="body2">{when}</Typography>
            {rooms.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {rooms.join(' · ')}
              </Typography>
            )}
          </Stack>
        );
      },
    },
    {
      field: 'grade_level',
      headerName: 'Year group',
      sortable: true,
      render: (c) => <Typography variant="body2">{c.grade_level}</Typography>,
    },
    {
      field: 'enrolled_count',
      headerName: 'Enrolled',
      align: 'right',
      render: (c) => {
        const capacity = c.capacity ?? 0;
        const over = capacity > 0 && c.enrolled_count > capacity;
        return (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}
          >
            <Typography variant="body2" component="span">
              {c.enrolled_count}
              {capacity > 0 ? `/${capacity}` : ''}
            </Typography>
            {over && <StatusBadge label="Over capacity" kind="warning" />}
          </Box>
        );
      },
    },
    {
      field: 'is_archived',
      headerName: 'Status',
      render: (c) =>
        c.is_archived ? (
          <StatusBadge label="Archived" kind="neutral" />
        ) : (
          <StatusBadge label="Active" kind="success" />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={isTeacher || isStudent ? 'My Classes' : 'Classes'}
        subtitle={
          isTeacher
            ? 'The subject classes you teach. Open one for its roster, schedule and gradebook.'
            : isStudent
              ? 'Every subject class you take. Open one to see its assessments.'
              : 'Subject classes across the school — each has one subject, its own teacher, room and time, and its own roster.'
        }
        primaryAction={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setFormError(null);
                setFieldErrors(undefined);
                setCreateOpen(true);
              }}
            >
              Add class
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
        searchPlaceholder="Search classes…"
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
            {showSubjectFilter && (
              <TextField
                select
                size="small"
                label="Subject"
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 180 }}
                disabled={subjectsQuery.isLoading}
              >
                <MenuItem value="">All subjects</MenuItem>
                {subjectOptions.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </>
        }
      />

      <DataTable<ClassListItem>
        caption="Subject classes list"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(c) => c.id}
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
        emptyTitle={
          debouncedSearch || subjectId ? 'No classes match your filters' : 'No classes yet'
        }
        emptyDescription={
          debouncedSearch || subjectId
            ? 'Try a different name or subject.'
            : 'Subject classes will appear here once created.'
        }
      />

      {canManage && (
        <ClassFormDialog
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

export default ClassesListPage;
