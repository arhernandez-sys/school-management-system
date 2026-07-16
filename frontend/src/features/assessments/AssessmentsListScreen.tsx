import { useMemo, useState } from 'react';
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
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { DEMO_IDS } from '@shared/api/mocks/demo/dataset';
import {
  useAssessmentCategories,
  useAssessmentsList,
  useClassSubjectOptions,
  useCreateAssessment,
  useDeleteAssessment,
  useSetAssessmentStatus,
  useUpdateAssessment,
  type AssessmentListItem,
} from './hooks/useAssessments';
import { AssessmentFormDialog, type AssessmentFormValues } from './components/AssessmentFormDialog';
import { ClassSubjectPicker } from './components/ClassSubjectPicker';
import { NEXT_STATUSES, STATUS_META, TYPE_LABEL, transitionLabel } from './statusMeta';

const CLASS_SUBJECT_PARAM = 'class_subject_id';

/**
 * Assessments list — the assessment-first authoring surface (API-9). You pick a
 * class_subject (URL-persisted via `?class_subject_id=`), then create/edit assessment
 * DEFINITIONS and drive their status lifecycle (draft → published → grading → graded).
 * Grade ENTRY lives in the Grades module.
 *
 * Scope:
 *  - Teacher: the picker lists ONLY their owned offerings; authoring is enabled.
 *  - Principal / Secretary: the picker lists all offerings; view-all, no authoring
 *    (OQ-API-2 — P/S do not author on a teacher's behalf). The server is authoritative.
 */
export function AssessmentsListScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const canAuthor = isTeacher; // P/S are view-all (OQ-API-2)
  const canGrade = !isStudent; // teacher (edit) + P/S (read-only) open the grading page

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCs = searchParams.get(CLASS_SUBJECT_PARAM) ?? '';

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // ── Picker options (scoped) ─────────────────────────────────────────────────────
  const optionsQuery = useClassSubjectOptions(
    isTeacher ? 'me' : 'all',
    user?.teacher_profile_id ?? null,
    yearId,
  );
  const options = optionsQuery.data ?? [];
  const selectedOption = options.find((o) => o.class_subject_id === selectedCs) ?? null;

  const setSelectedCs = (id: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set(CLASS_SUBJECT_PARAM, id);
        else next.delete(CLASS_SUBJECT_PARAM);
        return next;
      },
      { replace: true },
    );
    setPage(0);
  };

  // ── List (only once a class_subject is chosen) ────────────────────────────────────
  const listParams = useMemo(
    () => ({
      class_subject_id: selectedCs || undefined,
      academic_year_id: yearId || undefined,
      page: page + 1,
      page_size: pageSize,
      sort: '-assessment_date',
    }),
    [selectedCs, yearId, page, pageSize],
  );
  const listQuery = useAssessmentsList(listParams, Boolean(selectedCs));

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
  const categoriesQuery = useAssessmentCategories(formOpen ? selectedCs || null : null);

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
            type: values.type,
            category_id: values.category_id,
            assessment_date: values.assessment_date,
            max_score: values.max_score,
            weight: values.weight,
          },
        },
        { onSuccess: () => setFormOpen(false), onError },
      );
    } else {
      createMut.mutate(
        {
          class_subject_id: selectedCs,
          semester_id: DEMO_IDS.activeSemesterId,
          title: values.title,
          type: values.type,
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
    { field: 'type', headerName: 'Type', render: (a) => TYPE_LABEL[a.type] },
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
    { field: 'weight', headerName: 'Weight', align: 'right', hideOnMobile: true, render: (a) => a.weight },
    {
      field: 'status',
      headerName: 'Status',
      render: (a) => <StatusBadge label={STATUS_META[a.status].label} kind={STATUS_META[a.status].kind} />,
    },
  ];

  const openGrading = (a: AssessmentListItem) => {
    const csId = a.class_subject?.class_subject_id ?? selectedCs;
    navigate(`${ROUTES.gradeAssessment}/${a.id}?${CLASS_SUBJECT_PARAM}=${encodeURIComponent(csId)}`);
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
    canAuthor && selectedCs ? (
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
              ? "Assessments in your class. Pick a subject to see its quizzes, tests, and exams."
              : 'Browse assessments across the school.'
        }
        primaryAction={primaryAction}
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        {!isStudent && (
          <YearSelect
            value={yearId}
            onChange={(id) => {
              // A class·subject belongs to one year — clear the stale selection.
              setSelectedCs('');
              setYearId(id);
              setPage(0);
            }}
            years={years}
            activeYearId={activeYearId}
            isLoading={yearsLoading}
          />
        )}
        <ClassSubjectPicker
          options={options}
          value={selectedCs}
          onChange={setSelectedCs}
          isLoading={optionsQuery.isLoading}
          disabled={optionsQuery.isError}
        />
      </Stack>

      {optionsQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          Could not load your class subjects.{' '}
          <Button size="small" onClick={() => void optionsQuery.refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      {!selectedCs ? (
        <EmptyState
          variant="card"
          title="Select a class subject"
          description={
            isTeacher
              ? 'Choose one of your class subjects to view and create its assessments.'
              : isStudent
                ? 'Choose one of your subjects to see its assessments.'
                : 'Choose a class subject to view its assessments.'
          }
        />
      ) : (
        <>
          {selectedOption && (
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {selectedOption.label}
            </Typography>
          )}
          <DataTable<AssessmentListItem>
            caption="Assessments for the selected class subject"
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
