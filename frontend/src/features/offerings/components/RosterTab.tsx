import { useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar, Tooltip, Typography } from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import {
  ConfirmDialog,
  DataTable,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useOfferingRoster, useWithdrawStudent } from '../hooks/useOfferings';
import type { RosterEntry } from '../types';
import { EnrollStudentsDialog } from './EnrollStudentsDialog';

/**
 * Offering detail → Roster tab (ui-design-system §7.5, api-spec §5). Shows the offering's
 * active roster. P/S can add students (enroll, warn-only capacity D-Q6) and withdraw a
 * student (sets `unenrolled_at`; grade/attendance history is preserved). Lecturers see a
 * read-only roster. Over-capacity after an enroll is surfaced as a non-blocking toast.
 *
 * **D31** — the roster hangs off the OFFERING, not a homeroom. Withdrawing a student here
 * drops them from this one course, which is the whole point: a student takes several
 * courses in a term and leaving one is not leaving the others.
 */
export interface RosterTabProps {
  offeringId: string;
  /** The server-computed offering label, for captions and confirmation copy. */
  offeringLabel: string;
  canManage: boolean;
}

export function RosterTab({ offeringId, offeringLabel, canManage }: RosterTabProps) {
  const query = useOfferingRoster(offeringId);
  const withdrawMut = useWithdrawStudent(offeringId);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<RosterEntry | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'warning' } | null>(
    null,
  );

  const handleWithdraw = () => {
    if (!withdrawTarget) return;
    setWithdrawError(null);
    withdrawMut.mutate(withdrawTarget.enrollment_id, {
      onSuccess: () => {
        setToast({
          message: `${withdrawTarget.student.full_name} was withdrawn from ${offeringLabel}.`,
          severity: 'success',
        });
        setWithdrawTarget(null);
      },
      onError: (err) => setWithdrawError(apiErrorMessage(err)),
    });
  };

  const columns: DataTableColumn<RosterEntry>[] = [
    {
      field: 'student',
      headerName: 'Student',
      primary: true,
      render: (r) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {r.student.full_name}
        </Typography>
      ),
    },
    {
      field: 'student_number',
      headerName: 'Student #',
      render: (r) => <Typography variant="body2">{r.student.student_number}</Typography>,
    },
    {
      field: 'status',
      headerName: 'Status',
      render: (r) =>
        r.unenrolled_at ? (
          <StatusBadge label="Withdrawn" kind="neutral" />
        ) : (
          <StatusBadge label="Enrolled" kind="success" />
        ),
    },
  ];

  const rowActions = canManage
    ? (r: RosterEntry) => (
        <Tooltip title="Withdraw from this offering">
          <IconButton
            size="small"
            color="error"
            aria-label={`Withdraw ${r.student.full_name}`}
            onClick={() => {
              setWithdrawError(null);
              setWithdrawTarget(r);
            }}
          >
            <PersonRemoveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )
    : undefined;

  const total = query.data?.length ?? 0;

  return (
    <>
      {canManage && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<PersonAddAlt1Icon />}
            onClick={() => setEnrollOpen(true)}
          >
            Add students
          </Button>
        </Box>
      )}

      <DataTable<RosterEntry>
        caption={`Roster for ${offeringLabel}`}
        columns={columns}
        rows={query.data ?? []}
        getRowId={(r) => r.enrollment_id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        // Roster is not server-paginated (an offering is ≤ ~35 students).
        page={0}
        pageSize={100}
        total={total}
        rowsPerPageOptions={[100]}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle="No students enrolled"
        emptyDescription={
          canManage
            ? 'Add students to build this offering’s roster.'
            : 'This offering has no enrolled students yet.'
        }
        emptyAction={canManage ? { label: 'Add students', onClick: () => setEnrollOpen(true) } : undefined}
        rowActions={rowActions}
      />

      {canManage && (
        <EnrollStudentsDialog
          open={enrollOpen}
          offeringId={offeringId}
          offeringLabel={offeringLabel}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={({ count, overCapacity }) =>
            setToast({
              message: overCapacity
                ? `Added ${count} student${count > 1 ? 's' : ''}. This offering is now over capacity.`
                : `Added ${count} student${count > 1 ? 's' : ''} to ${offeringLabel}.`,
              severity: overCapacity ? 'warning' : 'success',
            })
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(withdrawTarget)}
        title="Withdraw student?"
        destructive
        description={
          withdrawTarget
            ? `Remove ${withdrawTarget.student.full_name} from ${offeringLabel}? Their grade and attendance history is preserved.`
            : undefined
        }
        confirmLabel="Withdraw"
        pending={withdrawMut.isPending}
        error={withdrawError}
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawTarget(null)}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}

export default RosterTab;
