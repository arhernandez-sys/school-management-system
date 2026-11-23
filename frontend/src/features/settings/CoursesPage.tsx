import { useMemo, useState } from 'react';
import { Button, FormControlLabel, IconButton, Switch, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PrintIcon from '@mui/icons-material/Print';
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
import type { CourseListItem } from '@shared/api/generated/model';
import {
  useCoursesList,
  useCreateCourse,
  useUpdateCourse,
  useDeleteCourse,
} from './hooks/useCourses';
import { CourseFormDialog, type CourseFormValues } from './components/CourseFormDialog';
import { PrerequisitesDialog } from './components/PrerequisitesDialog';
import { CourseListPrintDialog } from './components/CourseListPrintDialog';

/**
 * Course catalog (api-spec §5b, ui-design-system Settings). The Dean manages; the list
 * defaults to active courses and can reveal retired ones. CRUD:
 *  - Create / edit via CourseFormDialog (409 duplicate_course_name/code surfaced inline).
 *  - Retire (soft) = PATCH is_active:false; Restore = PATCH is_active:true.
 *  - Delete (hard) allowed only when unused; 409 course_in_use is surfaced and the
 *    user is steered to retire instead.
 *
 * **D31** — this reads `/courses`, not `/subjects`. The URL was the last place the pre-D30
 * noun survived, after `Subject` → `Course` had already renamed 201 backend identifiers;
 * the three catalog error codes were renamed with it.
 *
 * This is the CATALOG, not the schedule: what a course IS (code, name, credits, component,
 * prerequisites). A scheduled instance of one lives in `features/offerings`.
 *
 * Management controls are hidden for non-Dean roles (UX only; the server enforces).
 */
export function CoursesPage() {
  const { user } = useAuth();
  // D30: the course catalog is Dean-only to write (brief §6). The Registrar still
  // reaches this tab — `courses: 'view-all'` — but read-only, so the server's new 403
  // is never something they can trigger from the UI.
  const canManage = user ? canWrite(user.role, 'courses') : false;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [showRetired, setShowRetired] = useState(false);
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      // Default (active-only) is the backend default when `is_active` is omitted —
      // which is precisely why omitting it could never show BOTH. `include_retired`
      // drops the filter; see `useCourses.CoursesListParams`.
      is_active: showRetired ? undefined : true,
      include_retired: showRetired || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: 'name',
    }),
    [debouncedSearch, showRetired, page, pageSize],
  );

  const query = useCoursesList(params);

  /** Same probe as the Programmes screen: `is_active: false` is "retired only", and its
   *  `total` decides whether the switch is worth rendering at all. */
  const retiredProbe = useCoursesList({ is_active: false, page: 1, page_size: 1 });
  const hasRetired = (retiredProbe.data?.total ?? 0) > 0;
  const createMut = useCreateCourse();
  const updateMut = useUpdateCourse();
  const deleteMut = useDeleteCourse();

  // ── dialog state ───────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  const [deleteTarget, setDeleteTarget] = useState<CourseListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // D30 §D4 — what this course requires. Reachable for the Registrar too (read-only):
  // knowing why an enrolment was refused is administration, not academic authority.
  const [prereqTarget, setPrereqTarget] = useState<CourseListItem | null>(null);

  // D43 — print/PDF of the catalog AS FILTERED. Open to every role that can reach the
  // tab: printing is reading, and the sheet contains nothing the screen does not.
  const [printOpen, setPrintOpen] = useState(false);

  /** What the printed sheet says selected these rows. Mirrors the two live filters. */
  const filterSummary = useMemo(
    () => [
      ...(debouncedSearch ? [`Search "${debouncedSearch}"`] : []),
      showRetired ? 'Active and retired' : 'Active only',
    ],
    [debouncedSearch, showRetired],
  );

  const openCreate = () => {
    setEditingCourse(null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (course: CourseListItem) => {
    setEditingCourse(course);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const handleFormSubmit = (values: CourseFormValues) => {
    setFormError(null);
    setFormFieldErrors({});
    const body = {
      name: values.name,
      // D30: `courses.code` is NOT NULL, so the code is always sent, never nulled.
      code: values.code,
      credits: values.credits,
      component: values.component,
    };
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editingCourse) {
      updateMut.mutate(
        { courseId: editingCourse.id, data: body },
        { onSuccess: () => setFormOpen(false), onError },
      );
    } else {
      createMut.mutate({ data: body }, { onSuccess: () => setFormOpen(false), onError });
    }
  };

  const handleToggleActive = (course: CourseListItem) => {
    updateMut.mutate(
      { courseId: course.id, data: { is_active: !course.is_active } },
      {
        // Restoring the LAST retired course hides the switch; drop the filter with it so
        // the list is not pinned to a view whose control has just disappeared.
        onSuccess: () => {
          void retiredProbe.refetch();
          if (!course.is_active) setShowRetired(false);
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMut.mutate(
      { courseId: deleteTarget.id },
      {
        onSuccess: () => setDeleteTarget(null),
        onError: (err) => setDeleteError(apiErrorMessage(err)),
      },
    );
  };

  const columns: DataTableColumn<CourseListItem>[] = [
    {
      field: 'name',
      headerName: 'Course',
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
      sortable: true,
      render: (s) => <Typography variant="body2">{s.code}</Typography>,
    },
    {
      // D30 §D2 — the reason the catalog moved to `courses` at all: without a credit
      // value reachable from a graded row, GPA and credits-earned are impossible.
      field: 'credits',
      headerName: 'Credits',
      sortable: true,
      render: (s) => <Typography variant="body2">{s.credits}</Typography>,
    },
    {
      field: 'component',
      headerName: 'Component',
      render: (s) =>
        s.component ?? (
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

  const prerequisitesAction = (s: CourseListItem) => (
    <Tooltip title="Prerequisites">
      <IconButton
        size="small"
        aria-label={`Prerequisites for ${s.name}`}
        onClick={() => setPrereqTarget(s)}
      >
        <AccountTreeIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );

  const rowActions = canManage
    ? (s: CourseListItem) => (
        <>
          {prerequisitesAction(s)}
          <Tooltip title="Edit">
            <IconButton size="small" aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {/* D41 — Restore is GREEN, Retire is not.
              The two sat side by side in the same default grey, differing only by an
              Archive/Unarchive glyph that is the same box with the arrow flipped — at 20px,
              in a row of icon buttons, that is not a difference anyone reads before
              clicking. Colour carries the meaning the glyph was failing to: restoring puts
              something back, and green is what this app already uses for an active state
              (`StatusBadge kind="success"`). Retire stays neutral rather than turning red —
              it is reversible, and red is reserved for Delete, which is not. */}
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
                color="success"
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
    : prerequisitesAction;

  return (
    <>
      <PageHeader
        title="Course Catalog"
        subtitle="Manage the catalog of courses the college offers."
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              Add course
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
        searchPlaceholder="Search courses…"
        trailing={
          // Only when there IS something retired to reveal - see `hasRetired`.
          hasRetired ? (
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
          ) : undefined
        }
      />

      <DataTable<CourseListItem>
        caption="Course catalog"
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
        emptyTitle={debouncedSearch ? 'No courses match your search' : 'No courses yet'}
        emptyDescription={
          canManage && !debouncedSearch ? 'Add your first course to get started.' : undefined
        }
        emptyAction={
          canManage && !debouncedSearch ? { label: 'Add course', onClick: openCreate } : undefined
        }
        rowActions={rowActions}
      />

      <CourseFormDialog
        open={formOpen}
        course={editingCourse}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <CourseListPrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        params={params}
        filterSummary={filterSummary}
      />

      <PrerequisitesDialog
        open={Boolean(prereqTarget)}
        course={prereqTarget}
        canManage={canManage}
        onClose={() => setPrereqTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete course?"
        destructive
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.name}"? This is only possible while no offering schedules it. If one does, retire it instead.`
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

export default CoursesPage;
