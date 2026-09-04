import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  IconButton,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import PrintIcon from '@mui/icons-material/Print';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  SearchableSelect,
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce, useYearFilter } from '@shared/hooks';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useCoursesList } from '@features/settings/hooks/useCourses';
import { useCreateOffering, useOfferingsList, useUpdateOffering } from './hooks/useOfferings';
import { OfferingFormDialog } from './components/OfferingFormDialog';
import { OfferingListPrintDialog } from './components/OfferingListPrintDialog';
import { roomsOf, summarizeMeetings } from './meetingFormat';
import { strings } from '@i18n/strings';
import type { OfferingCreateBody, OfferingListItem, OfferingUpdateBody } from './types';

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
  // Memoised because `?? []` is a fresh array every render, and D43's `filterSummary`
  // depends on this list to resolve `course_id` to a printable course name.
  const courseOptions = useMemo(() => coursesQuery.data?.items ?? [], [coursesQuery.data]);

  const [createOpen, setCreateOpen] = useState(false);
  // D41 — the row being edited, or null. Holding the ROW rather than an id keeps the
  // dialog seedable without a detail fetch: the list already carries everything it edits.
  const [editing, setEditing] = useState<OfferingListItem | null>(null);
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

  // D43 — print/PDF of the schedule AS FILTERED. Open to every role that reaches the page;
  // the server already scopes the rows, so a lecturer prints their own load.
  const [printOpen, setPrintOpen] = useState(false);

  /** What the printed sheet says selected these rows. Resolves ids to the names a reader
   *  would recognise — a caption reading `course_id 9f3c…` is worse than no caption. */
  const filterSummary = useMemo(() => {
    const yearName = years.find((y) => y.id === yearId)?.name;
    const course = courseOptions.find((c) => c.id === courseId);
    return [
      ...(debouncedSearch ? [`Search "${debouncedSearch}"`] : []),
      ...(yearName ? [`Year ${yearName}`] : []),
      ...(course ? [`Course ${course.code} — ${course.name}`] : []),
    ];
  }, [debouncedSearch, yearId, years, courseId, courseOptions]);

  const createMut = useCreateOffering();
  // Keyed by the row under edit. `?? ''` keeps the hook unconditional — it is only ever
  // CALLED from the dialog, which does not exist unless a row is selected.
  const updateMut = useUpdateOffering(editing?.id ?? '');

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

  const openEdit = (offering: OfferingListItem) => {
    setFormError(null);
    setFieldErrors(undefined);
    setEditing(offering);
  };

  const handleUpdate = (values: OfferingUpdateBody) => {
    setFormError(null);
    setFieldErrors(undefined);
    updateMut.mutate(values, {
      onSuccess: (saved) => {
        setEditing(null);
        setToast(`${saved.label} was updated.`);
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

  /**
   * D41 — Edit, on the row.
   *
   * `canManage` gates it, not `actionable_by_caller`: that flag is the LECTURER's write
   * scope (their own offerings' rosters and grades), and a lecturer editing the capacity
   * or archive state of a course they happen to teach is a different permission the
   * server does not grant them. `PATCH /offerings/{id}` is Dean/Registrar only.
   */
  const rowActions = canManage
    ? (o: OfferingListItem) => (
        <Tooltip title="Edit">
          <IconButton size="small" aria-label={`Edit ${o.label}`} onClick={() => openEdit(o)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )
    : undefined;

  return (
    <>
      <PageHeader
        title={isTeacher ? strings.nav.myCourses : strings.nav.offerings}
        subtitle={
          isTeacher
            ? 'The course offerings you teach. Open one for its roster, schedule and gradebook.'
            : 'Every scheduled offering — each is one course in one semester, with its own lecturer, room, time and roster.'
        }
        secondaryActions={
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => setPrintOpen(true)}
            disabled={query.isLoading}
          >
            Print list
          </Button>
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
              // D43-b — type-to-filter. This picker lists the whole catalog (114
              // courses today), which is well past the point where scrolling a menu
              // beats typing three letters of the code.
              <SearchableSelect
                label={strings.terms.course}
                value={courseId}
                onChange={(v) => {
                  setCourseId(v);
                  setPage(0);
                }}
                allOption="All courses"
                options={courseOptions.map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: c.code,
                }))}
                loading={coursesQuery.isLoading}
                sx={{ minWidth: 260 }}
              />
            )}
          </>
        }
      />

      <DataTable<OfferingListItem>
        caption="Course offerings list"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(o) => o.id}
        rowActions={rowActions}
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
        <>
          <OfferingFormDialog
            open={createOpen}
            submitting={createMut.isPending}
            error={formError}
            fieldErrors={fieldErrors}
            onSubmit={handleCreate}
            onClose={() => setCreateOpen(false)}
          />
          {/* A SEPARATE instance from the create dialog above. Sharing one mount would
              carry the create form's half-filled state into an edit and back again.

              Deliberately NOT keyed by the row: the dialog re-seeds from its `offering`
              dependency, so switching from one offering straight to another is already
              handled, and a key that changed on close would remount the dialog mid-exit
              and make it disappear instead of animating out. */}
          <OfferingFormDialog
            open={Boolean(editing)}
            offering={editing}
            submitting={updateMut.isPending}
            error={formError}
            fieldErrors={fieldErrors}
            onSubmit={handleCreate}
            onUpdate={handleUpdate}
            onClose={() => setEditing(null)}
          />
        </>
      )}

      <OfferingListPrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        params={params}
        filterSummary={filterSummary}
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

export default OfferingsListPage;
