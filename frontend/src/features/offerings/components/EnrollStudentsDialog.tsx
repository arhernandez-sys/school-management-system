import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { FormDialog, LoadingState, EmptyState } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useDebounce } from '@shared/hooks';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useEnrollableStudents, useEnrollStudents } from '../hooks/useOfferings';

/**
 * Enroll students into an offering (api-spec §5 POST /offerings/{id}/enrollments).
 * P/S only (the caller gates rendering). Multi-select from the offering's enrollable
 * students (active, not already on the roster). Capacity is warn-only (D-Q6): the
 * enroll always succeeds — an over-capacity result is surfaced to the caller via
 * onEnrolled so the page can toast a non-blocking warning.
 *
 * **D31** — enrolling is purely ADDITIVE. Under the homeroom model, enrolling a student
 * closed their enrollment everywhere else in the semester, which in a college is data
 * loss: a student legitimately takes Algebra AND Biology. The response's
 * `schedule_conflicts` is what the office needs to see instead, and it does not fail the
 * write either.
 *
 * **D45 §3b P2 — a student the prerequisite gate will refuse is now shown as such.**
 * The picker used to list them indistinguishably from everyone else, and because the
 * enrol endpoint validates the WHOLE batch before writing anything, selecting one of
 * them refused every other student in the selection too. The reported symptom was
 * "it isn't allowing to add students in it".
 *
 * Ineligible rows are disabled rather than hidden: the Dean needs to see that the
 * student exists and why they are barred, which is the half a bare absence loses.
 *
 * **D45 §12/§20 (Phase 4) — THE DEAN MAY OVERRIDE.** A barred row is selectable for the
 * Dean and stays disabled for the Registrar, who cannot authorise a waiver (D30 §D14 —
 * waiving an academic rule is an academic-structure decision). Selecting one reveals a
 * REQUIRED reason; the reason is what turns a waiver into an audit record rather than a
 * hole with a name on it, and the server refuses without it.
 *
 * Before this, a Dean who had genuinely decided a student could proceed had no route but
 * to delete the prerequisite for the whole college — which is exactly what happened, and
 * is what sent us looking at prerequisites in the first place.
 */
export interface EnrollStudentsDialogProps {
  open: boolean;
  offeringId: string;
  /** The server-computed offering label, for the dialog title and captions. */
  offeringLabel: string;
  onClose: () => void;
  /** Called after a successful enroll; `overCapacity` drives a warn-only toast upstream. */
  onEnrolled: (result: { count: number; overCapacity: boolean }) => void;
}

export function EnrollStudentsDialog({
  open,
  offeringId,
  offeringLabel,
  onClose,
  onEnrolled,
}: EnrollStudentsDialogProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // §20 — only the Dean can act on these, so only the Dean is offered them.
  const [showBarred, setShowBarred] = useState(false);
  const [reason, setReason] = useState('');

  const { user } = useAuth();
  const canOverride = user?.role === 'principal';

  const listQuery = useEnrollableStudents(
    offeringId,
    debouncedSearch,
    open,
    showBarred && canOverride,
  );
  const enrollMut = useEnrollStudents(offeringId);

  // Reset transient state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(new Set());
      setError(null);
      setShowBarred(false);
      setReason('');
    }
  }, [open]);

  // Cap the type-ahead result list to the top 5 matches (the hook has no page_size param).
  //
  // D45 §3b P2 — ELIGIBLE STUDENTS SORT FIRST, then the cap applies. Without this the five
  // visible rows could all be students the gate refuses, and the picker would look broken
  // in exactly the way it already did. Barred students therefore surface only once there
  // are fewer than five addable ones, which is when the Dean needs to know why.
  const students = [...(listQuery.data ?? [])]
    .sort((a, b) => Number(a.eligible === false) - Number(b.eligible === false))
    .slice(0, 5);
  const barredCount = students.filter((s) => s.eligible === false).length;
  const selectedCount = selected.size;

  // Which rules the CURRENT selection actually needs waived. Sending only these keeps a
  // waiver honest: the audit row then names the rule that was really set aside, instead
  // of blanket-waiving everything the Dean happens to be able to waive.
  const selectedBarred = students.filter((s) => selected.has(s.id) && s.eligible === false);
  const needsOverride = selectedBarred.length > 0;
  const overrideRules = {
    prerequisites: selectedBarred.some((s) => s.ineligible_rule === 'prerequisites'),
    student_status: selectedBarred.some((s) => s.ineligible_rule === 'student_status'),
  };
  // Mirrors the server's `min_length=5`, so the refusal happens here rather than as a 422.
  const reasonValid = reason.trim().length >= 5;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (selectedCount === 0) return;
    if (needsOverride && !reasonValid) {
      setError('Give a reason for the override — it is recorded against you.');
      return;
    }
    setError(null);
    const vars = needsOverride
      ? { studentIds: Array.from(selected), override: { ...overrideRules, reason: reason.trim() } }
      : { studentIds: Array.from(selected) };
    enrollMut.mutate(vars, {
      onSuccess: (result) => {
        onEnrolled({ count: result.enrolled.length, overCapacity: result.over_capacity_warning });
        onClose();
      },
      onError: (err) => setError(apiErrorMessage(err)),
    });
  };

  const listId = useMemo(() => `enrollable-${offeringId}`, [offeringId]);

  return (
    <FormDialog
      open={open}
      title={`Add students to ${offeringLabel}`}
      submitLabel={
        selectedCount === 0
          ? 'Add students'
          : needsOverride
            ? `Override and add ${selectedCount} student${selectedCount > 1 ? 's' : ''}`
            : `Add ${selectedCount} student${selectedCount > 1 ? 's' : ''}`
      }
      submitting={enrollMut.isPending}
      submitDisabled={selectedCount === 0 || (needsOverride && !reasonValid)}
      error={error}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <TextField
        label="Search students"
        type="search"
        size="small"
        fullWidth
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or student number…"
        sx={{ mb: 1 }}
      />

      {canOverride && (
        <FormControlLabel
          sx={{ mb: 1, display: 'block' }}
          control={
            <Switch
              size="small"
              checked={showBarred}
              onChange={(e) => setShowBarred(e.target.checked)}
            />
          }
          label="Also show students who cannot normally register (graduated, inactive, suspended)"
        />
      )}

      {barredCount > 0 && (
        <Alert severity={canOverride ? 'warning' : 'info'} sx={{ mb: 1 }}>
          {barredCount === 1
            ? '1 student below is barred'
            : `${barredCount} students below are barred`}{' '}
          {canOverride
            ? 'by a registration rule. As Dean you may select them anyway — you will be asked for a reason, and the waiver is recorded against you. The rule stays in force for everyone else.'
            : "by a registration rule, and cannot be selected. The reason is shown on each row; only the Dean can authorise an exception."}
        </Alert>
      )}

      {needsOverride && (
        <TextField
          label="Reason for the override"
          required
          multiline
          minRows={2}
          fullWidth
          size="small"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={reason.length > 0 && !reasonValid}
          helperText={
            reason.length > 0 && !reasonValid
              ? 'Say why the rule is being set aside (at least 5 characters).'
              : `Recorded in the audit trail against you, for ${selectedBarred.length} student${selectedBarred.length > 1 ? 's' : ''}.`
          }
          sx={{ mb: 1 }}
        />
      )}

      {listQuery.isError ? (
        <Typography role="alert" color="error" variant="body2" sx={{ py: 2 }}>
          Could not load students. Please try again.
        </Typography>
      ) : listQuery.isLoading ? (
        <LoadingState variant="form" rows={4} label="Loading students" />
      ) : students.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? 'No matching students' : 'No students to add'}
          description={
            debouncedSearch
              ? 'Try a different name or student number.'
              : 'Every active student is already enrolled in this offering.'
          }
          variant="card"
        />
      ) : (
        <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
          <List dense aria-label={`Enrollable students for ${offeringLabel}`} id={listId}>
            {students.map((s) => {
              const checked = selected.has(s.id);
              const barred = s.eligible === false && !canOverride;
              return (
                <ListItemButton
                  key={s.id}
                  onClick={() => !barred && toggle(s.id)}
                  disabled={barred}
                  role="checkbox"
                  aria-checked={checked}
                  aria-disabled={barred}
                  selected={checked}
                  // The reason is on the row itself, not only in a tooltip: a tooltip is
                  // unreachable by touch and by a screen reader driving the list.
                  sx={barred ? { opacity: 1, cursor: 'not-allowed' } : undefined}
                >
                  <Checkbox
                    edge="start"
                    checked={checked}
                    disabled={barred}
                    tabIndex={-1}
                    disableRipple
                    inputProps={{ 'aria-label': `Select ${s.full_name}` }}
                  />
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <span>{s.full_name}</span>
                        {s.eligible === false && (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label={
                              s.ineligible_rule === 'student_status'
                                ? 'Not registrable'
                                : 'Prerequisite not met'
                            }
                          />
                        )}
                      </Stack>
                    }
                    secondary={
                      s.eligible === false
                        ? `${s.student_number} · ${s.ineligible_reason ?? 'Cannot be registered.'}`
                        : s.student_number
                    }
                    secondaryTypographyProps={
                      s.eligible === false ? { color: 'warning.main' } : undefined
                    }
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      )}
    </FormDialog>
  );
}

export default EnrollStudentsDialog;
