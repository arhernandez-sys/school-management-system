import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import GradingIcon from '@mui/icons-material/Grading';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  ConfirmDialog,
  SessionSelect,
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { useSessionFilter, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useSelectedYear } from '@app/providers/YearContext';
import {
  useAssessmentCategories,
  useAssessmentsList,
  useOfferingPickerOptions,
  useCreateAssessment,
  useDeleteAssessment,
  useSetAssessmentStatus,
  useUpdateAssessment,
  type AssessmentListItem,
} from './hooks/useAssessments';
import { AssessmentFormDialog, type AssessmentFormValues } from './components/AssessmentFormDialog';
import { OfferingPicker } from './components/OfferingPicker';
import { NEXT_STATUSES, STATUS_META, transitionLabel } from './statusMeta';

const OFFERING_PARAM = 'offering_id';

/**
 * Assessments list — the assessment-first authoring surface (API-9). You pick a COURSE
 * OFFERING (URL-persisted via `?offering_id=`), then create/edit assessment DEFINITIONS and
 * drive their status lifecycle (draft → published → grading → graded). Grade ENTRY lives in
 * the Grades module.
 *
 * Scope, all of it SERVER-decided: the picker feed is scoped to the caller, so a lecturer
 * gets the offerings they teach and the Dean and Registrar get all. This screen no longer
 * tells the server whose offerings to return — it used to pass `scope` plus the caller's own
 * `teacher_profile_id`, which is a request to be trusted about identity.
 *  - Lecturer: authoring is enabled on their own offerings.
 *  - Dean / Registrar: view-all, no authoring (OQ-API-2 — they do not author on a
 *    lecturer's behalf). The server is authoritative.
 *  - Student ("My Assessments"): read-only, and scoped by the GLOBAL top-bar year·semester
 *    switcher rather than by a picker on this page (see below).
 */
export function AssessmentsListScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const canGrade = !isStudent; // teacher (edit) + P/S (read-only) open the grading page

  /**
   * Two period sources, one per audience — and picking the wrong one was THE bug on
   * this screen. Staff scope per-module via `useYearFilter` (URL `?year=`, rendered as
   * the `<YearSelect>` below). A student has no `<YearSelect>` here (`!isStudent`, they
   * use the global top-bar switcher) — yet this screen still read `useYearFilter`, whose
   * value for a student could only ever resolve to the ACTIVE year because nothing on
   * the page writes `?year=`. So the global switcher moved every other student screen
   * and left this one pinned to the current year, subject dropdown included.
   *
   * `useYearFilter` is still called unconditionally — hooks cannot be conditional — but
   * for a student its result is deliberately unused.
   */
  const staffYear = useYearFilter();
  // Staff pick a session beside the year; it defaults to the active one. Only the active
  // session is writable — any other is browsed read-only (the server enforces the same).
  const staffSession = useSessionFilter(staffYear.yearId);
  const { selectedYearId, selectedSemesterId, selectedPeriod } = useSelectedYear();
  const yearId = isStudent ? selectedYearId : staffYear.yearId;
  const sessionReadOnly = !isStudent && !staffSession.isLoading && !staffSession.isActive;
  const canAuthor = isTeacher && !sessionReadOnly; // P/S are view-all (OQ-API-2)

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOfferingId = searchParams.get(OFFERING_PARAM) ?? '';

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // ── Picker options (scoped server-side to the caller) ────────────────────────────
  const optionsQuery = useOfferingPickerOptions(yearId);
  // Memoized because the reconcile effect below depends on it — a fresh `[]` literal on
  // every render would re-run that effect continuously.
  // Only the chosen session's offerings; an offering belongs to one session. Students
  // take the session from the top-bar switcher, staff from the picker beside the year.
  // (Students used to get the whole year here, so the dropdown ignored the switcher.)
  const sessionId = isStudent ? selectedSemesterId : staffSession.sessionId;
  const options = useMemo(() => {
    const all = optionsQuery.data ?? [];
    if (!sessionId) return all;
    return all.filter((o) => o.semester?.id === sessionId);
  }, [optionsQuery.data, sessionId]);
  const selectedOption = options.find((o) => o.id === selectedOfferingId) ?? null;

  const setSelectedOfferingId = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(OFFERING_PARAM, id);
          else next.delete(OFFERING_PARAM);
          return next;
        },
        { replace: true },
      );
      setPage(0);
    },
    [setSearchParams],
  );

  /**
   * An offering belongs to ONE term, so an `?offering_id=` carried across a year change
   * names an offering that is not in the selected year — the table renders empty and the
   * picker shows a blank selection, which reads exactly like the switcher being broken.
   * Staff already clear it in `YearSelect.onChange`; a student's change arrives from
   * outside this screen (the top bar), so there is no event to hang it on and it has to
   * be reconciled here.
   *
   * Keyed on the OPTIONS rather than on the year: it must only fire once the new year's
   * options have actually loaded, otherwise it would wipe a valid selection during
   * every refetch.
   */
  useEffect(() => {
    // No `options.length === 0` bail-out: a session with no courses must still clear
    // the previous session's course, or its assessments stay on screen.
    if (!isStudent || !selectedOfferingId || optionsQuery.isPending) return;
    if (!options.some((o) => o.id === selectedOfferingId)) setSelectedOfferingId('');
  }, [isStudent, selectedOfferingId, options, optionsQuery.isPending, setSelectedOfferingId]);

  // ── List (only once an offering is chosen) ────────────────────────────────────────
  const listParams = useMemo(
    () => ({
      offering_id: selectedOfferingId || undefined,
      academic_year_id: yearId || undefined,
      // Students: the top-bar switcher's semester. Staff: the session picked beside
      // the year, so a year's active and inactive sessions are never mixed together.
      semester_id: isStudent
        ? selectedSemesterId || undefined
        : staffSession.sessionId || undefined,
      page: page + 1,
      page_size: pageSize,
      sort: '-assessment_date',
    }),
    [selectedOfferingId, yearId, isStudent, selectedSemesterId, staffSession.sessionId, page, pageSize],
  );
  const listQuery = useAssessmentsList(listParams, Boolean(selectedOfferingId));

  // ── Mutations ──────────────────────────────────────────────────────────────────
  const createMut = useCreateAssessment();
  const updateMut = useUpdateAssessment();
  const statusMut = useSetAssessmentStatus();
  const deleteMut = useDeleteAssessment();

  // ── Form dialog state ──────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AssessmentListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});
  const categoriesQuery = useAssessmentCategories(formOpen ? selectedOfferingId || null : null);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };
  const openEdit = (a: AssessmentListItem) => {
    setEditing(a);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const handleFormSubmit = (values: AssessmentFormValues) => {
    setFormError(null);
    setFormFieldErrors({});
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editing) {
      updateMut.mutate(
        {
          id: editing.id,
          body: {
            title: values.title,
            category_id: values.category_id,
            assessment_date: values.assessment_date,
            max_score: values.max_score,
            weight: values.weight,
          },
        },
        { onSuccess: () => setFormOpen(false), onError },
      );
    } else {
      // No `semester_id`: the server stamps the offering's own session. Sending the
      // school's active semester here is what made new assessments vanish from the
      // gradebook of an offering running in a different session.
      createMut.mutate(
        {
          offering_id: selectedOfferingId,
          title: values.title,
          category_id: values.category_id,
          assessment_date: values.assessment_date,
          max_score: values.max_score,
          weight: values.weight,
        },
        { onSuccess: () => setFormOpen(false), onError },
      );
    }
  };

  // ── Status action menu ────────────────────────────────────────────────────────
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
  const [statusTarget, setStatusTarget] = useState<AssessmentListItem | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const openStatusMenu = (e: React.MouseEvent<HTMLElement>, a: AssessmentListItem) => {
    setStatusAnchor(e.currentTarget);
    setStatusTarget(a);
  };
  const closeStatusMenu = () => {
    setStatusAnchor(null);
    setStatusTarget(null);
  };
  const applyStatus = (to: AssessmentListItem['status']) => {
    if (!statusTarget) return;
    setStatusError(null);
    const id = statusTarget.id;
    statusMut.mutate(
      { id, status: to },
      {
        onSuccess: closeStatusMenu,
        onError: (err) => setStatusError(apiErrorMessage(err)),
      },
    );
  };

  // ── Delete confirm ──────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<AssessmentListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => setDeleteError(apiErrorMessage(err)),
    });
  };

  // ── Columns ────────────────────────────────────────────────────────────────────
  const columns: DataTableColumn<AssessmentListItem>[] = [
    {
      field: 'title',
      headerName: 'Title',
      primary: true,
      render: (a) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {a.title}
        </Typography>
      ),
    },
    {
      field: 'assessment_date',
      headerName: 'Date',
      render: (a) =>
        a.assessment_date ?? (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
    { field: 'max_score', headerName: 'Max', align: 'right', render: (a) => a.max_score },
    {
      field: 'status',
      headerName: 'Status',
      render: (a) => <StatusBadge label={STATUS_META[a.status].label} kind={STATUS_META[a.status].kind} />,
    },
  ];

  const openGrading = (a: AssessmentListItem) => {
    const offeringId = a.offering?.id ?? selectedOfferingId;
    navigate(
      `${ROUTES.gradeAssessment}/${a.id}?${OFFERING_PARAM}=${encodeURIComponent(offeringId)}`,
    );
  };

  const rowActions = canGrade
    ? (a: AssessmentListItem) => {
        const nextStatuses = NEXT_STATUSES[a.status];
        return (
          <>
            <Tooltip title="Grade this class">
              <IconButton
                size="small"
                aria-label={`Grade ${a.title}`}
                onClick={() => openGrading(a)}
              >
                <GradingIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {canAuthor && (
              <>
                <Tooltip title="Edit">
                  <IconButton size="small" aria-label={`Edit ${a.title}`} onClick={() => openEdit(a)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={nextStatuses.length ? 'Change status' : 'No further status changes'}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Change status of ${a.title}`}
                      disabled={nextStatuses.length === 0}
                      onClick={(e) => openStatusMenu(e, a)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Delete (only if no grades)">
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={`Delete ${a.title}`}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(a);
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </>
        );
      }
    : undefined;

  const primaryAction =
    canAuthor && selectedOfferingId ? (
      <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
        New assessment
      </Button>
    ) : undefined;

  return (
    <Box sx={{ pt: 3 }}>
      <PageHeader
        title={isStudent ? 'My Assessments' : 'Assessments'}
        subtitle={
          isTeacher
            ? 'Create assessment definitions and manage their status. Enter grades in Grades.'
            : isStudent
              ? // Name the period rather than implying "now" — this screen is reachable
                // for any year·semester the student was enrolled in.
                selectedPeriod
                ? `Your assessments for ${selectedPeriod.label}. Pick a course to see its quizzes, tests, and exams.`
                : 'Your assessments. Pick a course to see its quizzes, tests, and exams.'
              : 'Browse assessments across the school.'
        }
        primaryAction={primaryAction}
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        {/* Staff only. A student's period comes from the GLOBAL top-bar switcher, so a
            second picker here would be a competing source of truth. */}
        {!isStudent && (
          <YearSelect
            value={staffYear.yearId}
            onChange={(id) => {
              // An offering belongs to one term — clear the stale selection.
              setSelectedOfferingId('');
              staffYear.setYearId(id);
              setPage(0);
            }}
            years={staffYear.years}
            activeYearId={staffYear.activeYearId}
            isLoading={staffYear.isLoading}
          />
        )}
        {!isStudent && (
          <SessionSelect
            value={staffSession.sessionId}
            onChange={(id) => {
              setSelectedOfferingId('');
              staffSession.setSessionId(id);
              setPage(0);
            }}
            sessions={staffSession.sessions}
            isLoading={staffSession.isLoading}
          />
        )}
        <OfferingPicker
          options={options}
          value={selectedOfferingId}
          onChange={setSelectedOfferingId}
          isLoading={optionsQuery.isLoading}
          disabled={optionsQuery.isError}
        />
      </Stack>

      {sessionReadOnly && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This session is not active. Its assessments and grades are read-only.
        </Alert>
      )}

      {optionsQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          Could not load your course offerings.{' '}
          <Button size="small" onClick={() => void optionsQuery.refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      {!selectedOfferingId ? (
        <EmptyState
          variant="card"
          title="Select a course offering"
          description={
            isTeacher
              ? 'Choose one of the courses you teach to view and create its assessments.'
              : isStudent
                ? 'Choose one of your courses to see its assessments.'
                : 'Choose a course offering to view its assessments.'
          }
        />
      ) : (
        <>
          {selectedOption && (
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {[selectedOption.course.name, selectedOption.label, selectedOption.semester?.name]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          )}
          <DataTable<AssessmentListItem>
            caption="Assessments for the selected course offering"
            columns={columns}
            rows={listQuery.data?.items ?? []}
            getRowId={(a) => a.id}
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
            emptyTitle="No assessments yet"
            emptyDescription={
              canAuthor ? 'Create the first assessment for this class subject.' : undefined
            }
            emptyAction={canAuthor ? { label: 'New assessment', onClick: openCreate } : undefined}
            rowActions={rowActions}
          />
        </>
      )}

      {/* Status transition menu */}
      <Menu anchorEl={statusAnchor} open={Boolean(statusAnchor)} onClose={closeStatusMenu}>
        {statusTarget &&
          NEXT_STATUSES[statusTarget.status].map((to) => (
            <MenuItem
              key={to}
              disabled={statusMut.isPending}
              onClick={() => applyStatus(to)}
            >
              <ListItemText>{transitionLabel(to, statusTarget.status)}</ListItemText>
            </MenuItem>
          ))}
        {statusError && (
          <MenuItem disabled>
            <Alert severity="error" sx={{ py: 0 }}>
              {statusError}
            </Alert>
          </MenuItem>
        )}
      </Menu>

      <AssessmentFormDialog
        open={formOpen}
        assessment={editing}
        categories={categoriesQuery.data ?? []}
        categoriesLoading={categoriesQuery.isLoading}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete assessment?"
        destructive
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.title}"? This is only possible when the assessment has no recorded grades.`
            : undefined
        }
        confirmLabel="Delete"
        pending={deleteMut.isPending}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}

export default AssessmentsListScreen;
