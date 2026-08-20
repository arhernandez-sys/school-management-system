import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import GradingIcon from '@mui/icons-material/Grading';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { useSelectedYear } from '@app/providers/YearContext';
import { ROUTES } from '@shared/constants/routes';
import {
  useAssessmentCategories,
  useAssessmentsList,
  useCreateAssessment,
  useDeleteAssessment,
  useSetAssessmentStatus,
  useUpdateAssessment,
  type AssessmentListItem,
} from '@features/assessments/hooks/useAssessments';
import { AssessmentFormDialog, type AssessmentFormValues } from '@features/assessments/components/AssessmentFormDialog';
import { NEXT_STATUSES, STATUS_META, TYPE_LABEL, transitionLabel } from '@features/assessments/statusMeta';
import type { OfferingOption } from './types';

const OFFERING_PARAM = 'offering_id';

/**
 * Grades drill-down for ONE OFFERING (reached by clicking an offering card). Lists the
 * offering's assessments; clicking an assessment opens the per-assessment grading page.
 * Lecturers who own the offering author here too — create / edit / status / delete — so
 * assessment management is folded into Grades (the standalone Assessments nav is gone for
 * staff). Grade entry itself stays on AssessmentGradingScreen.
 *
 * **D31** — one offering, one gradebook, one id. The screen used to be scoped by a
 * `class_subject_id` that pointed at a row in the join table between a homeroom and a
 * subject; the assessments it lists now hang off `offering_id` directly.
 */
export function OfferingGradesScreen({
  option,
  offeringId,
  canAuthor,
  onBack,
}: {
  option: OfferingOption | null;
  offeringId: string;
  canAuthor: boolean;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const listParams = useMemo(
    () => ({
      offering_id: offeringId,
      page: page + 1,
      page_size: pageSize,
      sort: '-assessment_date',
    }),
    [offeringId, page, pageSize],
  );
  const listQuery = useAssessmentsList(listParams, Boolean(offeringId));

  const createMut = useCreateAssessment();
  const updateMut = useUpdateAssessment();
  const statusMut = useSetAssessmentStatus();
  const deleteMut = useDeleteAssessment();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AssessmentListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});
  const categoriesQuery = useAssessmentCategories(formOpen ? offeringId : null);
  // Every assessment write needs the REAL active semester id. Read from YearContext,
  // which already holds `GET /settings/active-term` — no extra request. It was a
  // hardcoded demo-dataset id here, which no real database contains.
  const { activeSemesterId } = useSelectedYear();

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
      // No active semester → the write cannot be formed. Say so instead of posting a
      // request the server will reject with an error nobody can act on.
      if (!activeSemesterId) {
        setFormError(
          'No active semester is set for the school. An administrator must set the active term before assessments can be created.',
        );
        return;
      }
      createMut.mutate(
        {
          offering_id: offeringId,
          semester_id: activeSemesterId,
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

  // Status transition menu
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
  const [statusTarget, setStatusTarget] = useState<AssessmentListItem | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const applyStatus = (to: AssessmentListItem['status']) => {
    if (!statusTarget) return;
    setStatusError(null);
    statusMut.mutate(
      { id: statusTarget.id, status: to },
      {
        onSuccess: () => {
          setStatusAnchor(null);
          setStatusTarget(null);
        },
        onError: (err) => setStatusError(apiErrorMessage(err)),
      },
    );
  };

  // Delete confirm
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

  const openGrading = (a: AssessmentListItem) =>
    navigate(
      `${ROUTES.gradeAssessment}/${a.id}?${OFFERING_PARAM}=${encodeURIComponent(offeringId)}`,
    );

  const columns: DataTableColumn<AssessmentListItem>[] = [
    {
      field: 'title',
      headerName: 'Assessment',
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
    {
      field: 'status',
      headerName: 'Status',
      render: (a) => <StatusBadge label={STATUS_META[a.status].label} kind={STATUS_META[a.status].kind} />,
    },
  ];

  const rowActions = (a: AssessmentListItem) => {
    const nextStatuses = NEXT_STATUSES[a.status];
    return (
      <>
        <Tooltip title="Grade this class">
          <IconButton size="small" aria-label={`Grade ${a.title}`} onClick={() => openGrading(a)}>
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
                  onClick={(e) => {
                    setStatusAnchor(e.currentTarget);
                    setStatusTarget(a);
                  }}
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
  };

  return (
    <Box sx={{ pt: 3 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1 }}>
        All offerings
      </Button>
      <PageHeader
        title={option?.offering.course.name ?? 'Course offering'}
        subtitle={
          option
            ? [option.offering.label, option.offering.semester?.name].filter(Boolean).join(' · ')
            : undefined
        }
        primaryAction={
          canAuthor ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New assessment
            </Button>
          ) : undefined
        }
      />

      {listQuery.isError ? (
        <Alert severity="error" role="alert">
          Could not load assessments.{' '}
          <Button size="small" onClick={() => void listQuery.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : (
        <DataTable<AssessmentListItem>
          caption="Assessments for this offering"
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
            canAuthor
              ? 'Create the first assessment for this offering.'
              : 'No assessments to show.'
          }
          emptyAction={canAuthor ? { label: 'New assessment', onClick: openCreate } : undefined}
          rowActions={rowActions}
        />
      )}

      <Menu
        anchorEl={statusAnchor}
        open={Boolean(statusAnchor)}
        onClose={() => {
          setStatusAnchor(null);
          setStatusTarget(null);
        }}
      >
        {statusTarget &&
          NEXT_STATUSES[statusTarget.status].map((to) => (
            <MenuItem key={to} disabled={statusMut.isPending} onClick={() => applyStatus(to)}>
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

export default OfferingGradesScreen;
