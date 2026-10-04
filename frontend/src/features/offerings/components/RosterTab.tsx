import { useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar, Tooltip, Typography } from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import RuleIcon from '@mui/icons-material/Rule';
import {
  ConfirmDialog,
  DataTable,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useOfferingRoster, useWithdrawStudent } from '../hooks/useOfferings';
import { ENROLLMENT_STATUS_LABEL, type RosterEntry } from '../types';
import { EnrollStudentsDialog } from './EnrollStudentsDialog';
import { CourseStatusDialog } from './CourseStatusDialog';

/**
 * Offering detail → Roster tab (ui-design-system §7.5, api-spec §5). Shows the offering's
 * active roster. P/S can add students (enroll, warn-only capacity D-Q6) and withdraw a
 * student (sets `unenrolled_at`; grade/attendance history is preserved). Lecturers see a
 * read-only roster. Over-capacity after an enroll is surfaced as a non-blocking toast.
 *
 * **D31** — the roster hangs off the OFFERING, not a homeroom. Removing a student here
 * drops them from this one course, which is the whole point: a student takes several
 * courses in a term and leaving one is not leaving the others.
 *
 * **D35 split one word into two actions**, and the distinction is load-bearing:
 *
 * * **Course status** (`PATCH`) — the client's `coursestatus`: Audit, Withdrew passing,
 *   Withdrew failing. The student STAYS on the roster, because the transcript prints
 *   `AU` / `W/P` / `W/F` against the course. Deleting the row would erase that.
 * * **Remove** (`DELETE`) — un-enrols. The row closes and they leave the roster, which
 *   says the registration itself was a mistake.
 *
 * This second action used to be labelled "Withdraw", which is now the name of the first.
 * Two different actions sharing a word on one screen is how the wrong one gets clicked.
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
  const [statusTarget, setStatusTarget] = useState<RosterEntry | null>(null);
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
          message: `${withdrawTarget.student.full_name} was removed from ${offeringLabel}.`,
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
      // D35 — the COURSE STATUS, which is the interesting fact now. `unenrolled_at` still
      // wins when set: a removed row cannot be described by a course status at all (the
      // server 409s on that), so showing one would be a contradiction.
      render: (r) => {
        if (r.unenrolled_at) return <StatusBadge label="Removed" kind="neutral" />;
        if (r.enrollment_status === 'registered') {
          return <StatusBadge label="Enrolled" kind="success" />;
        }
        return (
          <StatusBadge
            label={ENROLLMENT_STATUS_LABEL[r.enrollment_status]}
            // An audit is a legitimate choice; a withdrawal is the one that costs the
            // student the course, so only that reads as a warning.
            kind={r.enrollment_status === 'audit' ? 'info' : 'warning'}
          />
        );
      },
    },
  ];

  const rowActions = canManage
    ? (r: RosterEntry) => (
        <>
          <Tooltip title="Set course status (audit / withdrew)">
            <IconButton
              size="small"
              aria-label={`Set course status for ${r.student.full_name}`}
              disabled={Boolean(r.unenrolled_at)}
              onClick={() => setStatusTarget(r)}
            >
              <RuleIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove from this offering (un-enrol)">
            <IconButton
              size="small"
              color="error"
              aria-label={`Remove ${r.student.full_name}`}
              onClick={() => {
                setWithdrawError(null);
                setWithdrawTarget(r);
              }}
            >
              <PersonRemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
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

      {canManage && (
        <CourseStatusDialog
          open={Boolean(statusTarget)}
          offeringId={offeringId}
          offeringLabel={offeringLabel}
          entry={statusTarget}
          onClose={() => setStatusTarget(null)}
          onSaved={(message) => setToast({ message, severity: 'success' })}
        />
      )}

      <ConfirmDialog
        open={Boolean(withdrawTarget)}
        title="Remove student from this offering?"
        destructive
        description={
          withdrawTarget
            ? `Un-enrol ${withdrawTarget.student.full_name} from ${offeringLabel}? Their grade and attendance history is preserved. If they SAT the course and left, set a course status of "Withdrew" instead — that keeps the course on their transcript.`
            : undefined
        }
        confirmLabel="Remove"
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
