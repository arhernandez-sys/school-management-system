import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import { DataTable, StatusBadge, type DataTableColumn } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useClassSubjects, useDetachSubject } from '../hooks/useClasses';
import type { ClassSubjectItem } from '../types';
import { AddSubjectDialog } from './AddSubjectDialog';
import { AssignTeachersDialog } from './AssignTeachersDialog';

/**
 * Class detail → Subjects tab (ui-design-system §7.5). Lists each `class_subject`
 * offering in the section — subject, assigned teacher(s), assessment count — with each
 * row linking toward that offering's gradebook
 * (`/grades?class_subject_id=…`, §7.7). The Subjects tab is the D23 hub from which each
 * subject's gradebook / assessments / teacher(s) are reached.
 *
 * Teachers attach to the OFFERING, not to the section (there is no homeroom teacher in
 * D23), so staffing is managed here: P/S get a per-row "Assign teacher" action that makes
 * the "Needs teacher" badge actionable and lets an existing assignment be changed.
 * `canManage` mirrors the `classes` permission the caller computed; teachers see the same
 * columns read-only. `assessment_count` and teacher names come straight from the API row.
 */
export interface SubjectsTabProps {
  classId: string;
  canManage: boolean;
}

export function SubjectsTab({ classId, canManage }: SubjectsTabProps) {
  const query = useClassSubjects(classId);

  // The targeted row is snapshotted into state so a background refetch of the subjects
  // list cannot re-seed the dialog under the user mid-edit.
  const [assignTarget, setAssignTarget] = useState<ClassSubjectItem | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ClassSubjectItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detach = useDetachSubject(classId);

  const columns: DataTableColumn<ClassSubjectItem>[] = [
    {
      field: 'subject',
      headerName: 'Subject',
      primary: true,
      render: (cs) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {cs.subject.name}
          </Typography>
          {cs.subject.code && (
            <Typography variant="caption" color="text.secondary">
              {cs.subject.code}
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      field: 'teachers',
      headerName: 'Teacher(s)',
      render: (cs) =>
        cs.teachers.length > 0 ? (
          <Typography variant="body2">
            {cs.teachers.map((t) => t.full_name).join(', ')}
          </Typography>
        ) : (
          <StatusBadge label="Needs teacher" kind="warning" />
        ),
    },
    {
      field: 'assessment_count',
      headerName: 'Assessments',
      align: 'right',
      render: (cs) => <Typography variant="body2">{cs.assessment_count}</Typography>,
    },
    {
      field: 'is_active',
      headerName: 'Status',
      render: (cs) =>
        cs.is_active ? (
          <StatusBadge label="Active" kind="success" />
        ) : (
          <StatusBadge label="Retired" kind="neutral" />
        ),
    },
  ];

  const removeSubject = async (cs: ClassSubjectItem) => {
    setError(null);
    try {
      await detach.mutateAsync(cs.class_subject_id);
      setToast(`${cs.subject.name} was removed from this section.`);
    } catch (err) {
      // The API refuses (409) once the offering has assessments, grades or teachers.
      // Surface its message rather than a generic failure — it explains WHY.
      setError(apiErrorMessage(err));
    } finally {
      setRemoveTarget(null);
    }
  };

  const rowActions = (cs: ClassSubjectItem) => (
    <>
      {canManage && (
        <Button
          size="small"
          startIcon={<ManageAccountsOutlinedIcon fontSize="small" />}
          aria-label={
            cs.teachers.length > 0
              ? `Change teachers for ${cs.subject.name}`
              : `Assign a teacher to ${cs.subject.name}`
          }
          onClick={() => setAssignTarget(cs)}
        >
          {cs.teachers.length > 0 ? 'Teachers' : 'Assign teacher'}
        </Button>
      )}
      <Button
        component={RouterLink}
        to={`${ROUTES.grades}?class_subject_id=${cs.class_subject_id}`}
        size="small"
        startIcon={<AssessmentOutlinedIcon fontSize="small" />}
        aria-label={`Open gradebook for ${cs.subject.name}`}
      >
        Gradebook
      </Button>
      {canManage && (
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon fontSize="small" />}
          aria-label={`Remove ${cs.subject.name} from this section`}
          onClick={() => setRemoveTarget(cs)}
        >
          Remove
        </Button>
      )}
    </>
  );

  return (
    <>
      {canManage && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddOutlinedIcon fontSize="small" />}
            onClick={() => setAddOpen(true)}
          >
            Add subject
          </Button>
        </Stack>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <DataTable<ClassSubjectItem>
        caption="Subjects taught in this section"
        columns={columns}
        rows={query.data ?? []}
        getRowId={(cs) => cs.class_subject_id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        // Sub-resource list isn't server-paginated; render it all on one page.
        page={0}
        pageSize={100}
        total={query.data?.length ?? 0}
        rowsPerPageOptions={[100]}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle="No subjects offered yet"
        emptyDescription={
          canManage
            ? 'Add a subject to this section to give it a gradebook and assign a teacher.'
            : 'Subjects added to this section will appear here, each with its own gradebook.'
        }
        rowActions={rowActions}
      />

      {canManage && (
        <AddSubjectDialog
          open={addOpen}
          classId={classId}
          existing={query.data ?? []}
          onClose={() => setAddOpen(false)}
          onAdded={(subjectName) => setToast(`${subjectName} was added to this section.`)}
        />
      )}

      <Dialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        aria-labelledby="remove-subject-title"
      >
        <DialogTitle id="remove-subject-title">
          Remove {removeTarget?.subject.name}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes the subject offering from this section, along with its gradebook.
            It is only possible while the offering has no assessments or grades.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)} disabled={detach.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={detach.isPending}
            onClick={() => removeTarget && void removeSubject(removeTarget)}
          >
            {detach.isPending ? 'Removing…' : 'Remove subject'}
          </Button>
        </DialogActions>
      </Dialog>

      {canManage && (
        <AssignTeachersDialog
          open={Boolean(assignTarget)}
          classId={classId}
          classSubject={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={({ subjectName, count }) =>
            setToast(
              count === 0
                ? `All teachers were removed from ${subjectName}.`
                : `${count} teacher${count > 1 ? 's' : ''} assigned to ${subjectName}.`,
            )
          }
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
        ) : undefined}
      </Snackbar>
    </>
  );
}

export default SubjectsTab;
