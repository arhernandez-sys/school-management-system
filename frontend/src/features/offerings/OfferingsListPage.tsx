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
import { useCoursesList } from '@features/settings/hooks/useCourses';
import { useCreateOffering, useOfferingsList } from './hooks/useOfferings';
import { OfferingFormDialog } from './components/OfferingFormDialog';
import { roomsOf, summarizeMeetings } from './meetingFormat';
import { strings } from '@i18n/strings';
import type { OfferingCreateBody, OfferingListItem } from './types';

/**
 * Course-offering list (api-spec §5 GET /offerings, ui-design-system §7.5).
 *
 * **D31** — a row is one COURSE OFFERING: one catalog course, one semester, an optional
 * section code, its own lecturer(s), weekly slot and roster. Two sections of MATH1110 are
 * two rows, the same course in Semester 2 is a third, and a student can be enrolled in
 * several rows at once.
 *
 * Two columns changed shape with the model:
 *  - **Offering** prints the server-computed `label`. An offering row stores no name (the
 *    label derives from course code + section + term), so there is nothing else to print
 *    and nothing to re-derive here.
 *  - **Term** replaced "Year group". `grade_level` went with the homeroom, and the term is
 *    what now distinguishes two otherwise identical rows — it is the column that makes
 *    "MATH1110-01 twice" legible instead of looking like a duplicate.
 *
 * The API returns course/teachers/meetings ON the list row, so none of those columns cost
 * a follow-up request.
 *
 * Capacity shows as `enrolled/capacity`; over-capacity surfaces a warn-only "Over capacity"
 * chip (D-Q6) — it never blocks. Scope is server-enforced (P/S = all, Lecturer = offerings
 * they teach, Student = offerings they are enrolled in); this screen renders what the API
 * returns.
 */
export function OfferingsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const canManage = user ? canWrite(user.role, 'offerings') : false;

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [courseId, setCourseId] = useState('');
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);
  // The course filter is a staff tool ("show me both sections of MATH1110"). A lecturer
  // sees only their own handful of offerings, so the picker would be noise.
  const showCourseFilter = canManage;
  const coursesQuery = useCoursesList({ page: 1, page_size: 200, sort: 'code' });
  const courseOptions = coursesQuery.data?.items ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      // Filters THROUGH the offering's semester — an offering carries no year of its own.
      academic_year_id: yearId || undefined,
      course_id: courseId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      // `label` is a SERVER sort key that orders by course code then section code — it does
      // NOT sort the formatted string, which would put "MATH1110-2" before "MATH1110-10".
      sort: 'label',
    }),
    [debouncedSearch, yearId, courseId, page, pageSize],
  );

  const query = useOfferingsList(params);
  const createMut = useCreateOffering();

  const goToOffering = (id: string) => navigate(`${ROUTES.offerings}/${id}`);

  const handleCreate = (values: OfferingCreateBody) => {
    setFormError(null);
    setFieldErrors(undefined);
    createMut.mutate(values, {
      onSuccess: (created) => {
        setCreateOpen(false);
        setToast(`${created.label} was added.`);
      },
      onError: (err) => {
        setFormError(apiErrorMessage(err));
        setFieldErrors(fieldErrorsFrom(err));
      },
    });
  };

  const columns: DataTableColumn<OfferingListItem>[] = [
    {
      field: 'label',
      headerName: strings.terms.courseOffering,
      sortable: true,
      primary: true,
      render: (o) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => goToOffering(o.id)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {o.label}
        </MuiLink>
      ),
    },
    {
      field: 'course',
      headerName: strings.terms.course,
      render: (o) =>
        o.course ? (
          <Stack spacing={0.25}>
            <Typography variant="body2">{o.course.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {[o.course.code, o.course.credits != null ? `${o.course.credits} cr` : null]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          </Stack>
        ) : (
          // Only reachable for a legacy row whose catalog entry could not be resolved.
          // Such an offering cannot be graded, so it is flagged rather than blanked.
          <StatusBadge label="No course" kind="warning" />
        ),
    },
    {
      field: 'teachers',
      headerName: strings.terms.lecturer,
      render: (o) =>
        o.teachers.length > 0 ? (
          <Typography variant="body2">{o.teachers.map((t) => t.full_name).join(', ')}</Typography>
        ) : (
          <StatusBadge label="Not assigned" kind="neutral" />
        ),
    },
    {
      field: 'meetings',
      headerName: 'When / where',
      render: (o) => {
        const when = summarizeMeetings(o.meetings);
        const rooms = roomsOf(o.meetings);
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
      field: 'semester',
      headerName: strings.terms.semester,
      render: (o) =>
        o.semester ? (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Typography variant="body2">{o.semester.name}</Typography>
            {o.semester.is_active && <StatusBadge label="Current" kind="info" />}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        ),
    },
    {
      field: 'enrolled_count',
      headerName: 'Enrolled',
      align: 'right',
      render: (o) => {
        const capacity = o.capacity ?? 0;
        const over = capacity > 0 && o.enrolled_count > capacity;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
            <Typography variant="body2" component="span">
              {o.enrolled_count}
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
      render: (o) =>
        o.is_archived ? (
          <StatusBadge label="Archived" kind="neutral" />
        ) : (
          <StatusBadge label="Active" kind="success" />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={isTeacher ? strings.nav.myCourses : strings.nav.offerings}
        subtitle={
          isTeacher
            ? 'The course offerings you teach. Open one for its roster, schedule and gradebook.'
            : 'Every scheduled offering — each is one course in one semester, with its own lecturer, room, time and roster.'
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
              Add offering
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
        searchPlaceholder="Search by course code or name…"
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
            {showCourseFilter && (
              <TextField
                select
                size="small"
                label={strings.terms.course}
                value={courseId}
                onChange={(e) => {
                  setCourseId(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 220 }}
                disabled={coursesQuery.isLoading}
              >
                <MenuItem value="">All courses</MenuItem>
                {courseOptions.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </>
        }
      />

      <DataTable<OfferingListItem>
        caption="Course offerings list"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(o) => o.id}
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
        sortField="label"
        sortDirection="asc"
        emptyTitle={
          debouncedSearch || courseId ? 'No offerings match your filters' : 'No offerings yet'
        }
        emptyDescription={
          debouncedSearch || courseId
            ? 'Try a different course or search term.'
            : 'Course offerings will appear here once scheduled.'
        }
      />

      {canManage && (
        <OfferingFormDialog
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

export default OfferingsListPage;
