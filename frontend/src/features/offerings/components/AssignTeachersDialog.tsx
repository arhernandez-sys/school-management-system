import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { FormDialog, LoadingState, EmptyState } from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { useTeachersList } from '@features/teachers/hooks/useTeachers';
import type { TeachersListParams } from '@features/teachers/types';
import { useAssignTeachers } from '../hooks/useOfferings';
import type { OfferingDetail, TeacherRef } from '../types';

/**
 * Assign lecturer(s) to one course offering (api-spec §5 PUT /offerings/{id}/teachers).
 * P/S only (the caller gates rendering).
 *
 * **D31** — the path lost its homeroom hop. It used to thread a class id AND a
 * class_subject id to reach one gradebook's lecturers, because owning one subject of a
 * section was a different question from owning the section. One course per offering makes
 * those the same question.
 *
 * The endpoint REPLACES the offering's teacher set, so the dialog always submits the full
 * intended selection. Two contract rules shape the UI:
 *  - `lead_teacher_id` must be a member of `teacher_ids` (else 422). Rather than let the
 *    server reject an impossible state, every selection change re-defaults the lead to the
 *    first remaining teacher — the same rule the server applies when the lead is omitted.
 *  - An empty set is legal and removes all lecturers. That is offered deliberately (an
 *    explicit warning + a "Remove all lecturers" submit label), never as a silent accident.
 *
 * The picker reads the paginated Lecturers directory, so it pages rather than truncating —
 * every lecturer is reachable via search or the pager. Selections are held separately from
 * the visible page, so they survive searching and paging.
 */

/** Picker page size — small enough to fit the dialog without an inner scroll war. */
const TEACHER_PAGE_SIZE = 8;

export interface AssignTeachersDialogProps {
  open: boolean;
  /**
   * The offering being staffed; `null` while no row is targeted.
   *
   * The whole `OfferingDetail` is taken rather than a hand-built subset: the dialog needs
   * the id, the label, the teacher set and the lead, and the caller already holds the
   * detail. The old signature took a SYNTHESIZED offering with two invented fields
   * (`assessment_count: 0`, `is_active: true`) purely to satisfy a shape it never read —
   * inventing data to fit a type is how a screen ends up displaying it.
   */
  offering: OfferingDetail | null;
  onClose: () => void;
  /** Called after a successful save so the caller can toast the outcome. */
  onAssigned: (result: { offeringLabel: string; count: number }) => void;
}

/** Set-equality on teacher ids — order is not meaningful to the server. */
function sameTeacherSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

export function AssignTeachersDialog({
  open,
  offering: target,
  onClose,
  onAssigned,
}: AssignTeachersDialogProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0); // 0-based in the UI; the API is 1-based
  const [selected, setSelected] = useState<TeacherRef[]>([]);
  const [lead, setLead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);

  // The caller clears its target on close, so hold the last targeted offering to render
  // through the closing transition — otherwise the body swaps to empty copy mid-fade.
  const [offering, setOffering] = useState<OfferingDetail | null>(target);
  useEffect(() => {
    if (target) setOffering(target);
  }, [target]);

  // The offering's saved state — both the seed for the form and the dirty-check baseline.
  const initialTeachers = useMemo(() => offering?.teachers ?? [], [offering]);
  const initialIds = useMemo(() => initialTeachers.map((t) => t.id), [initialTeachers]);
  const initialLead = useMemo(
    () => offering?.lead_teacher_id ?? initialTeachers[0]?.id ?? null,
    [offering, initialTeachers],
  );

  // Reset transient state and re-seed from the offering whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setSearch('');
      setPage(0);
      setSelected(initialTeachers);
      setLead(initialLead);
      setError(null);
      setFieldErrors(undefined);
    }
  }, [open, initialTeachers, initialLead]);

  // A new search starts at the first page, otherwise the pager can strand the user past the
  // end of a shorter result set.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const params = useMemo<TeachersListParams>(
    () => ({
      search: debouncedSearch || undefined,
      // Only active staff are assignable. Anyone already assigned stays visible (and
      // removable) in the "Assigned" list above regardless of their current status.
      status: 'active',
      page: page + 1,
      page_size: TEACHER_PAGE_SIZE,
      sort: 'full_name',
    }),
    [debouncedSearch, page],
  );

  const listQuery = useTeachersList(params, open);
  // `handleSubmit` returns early without an offering, so '' never reaches the wire.
  const assignMut = useAssignTeachers(offering?.id ?? '');

  const teachers = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.total_pages ?? 0;
  const rangeStart = total === 0 ? 0 : page * TEACHER_PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * TEACHER_PAGE_SIZE + teachers.length);

  const selectedIds = selected.map((t) => t.id);
  const isDirty = !sameTeacherSet(selectedIds, initialIds) || lead !== initialLead;
  const willClearAll = selected.length === 0 && initialIds.length > 0;

  /**
   * Add/remove a teacher, keeping the lead a member of the set. Deselecting the lead
   * promotes the next remaining teacher instead of leaving a set the server would 422.
   */
  const toggle = (teacher: TeacherRef) => {
    const isSelected = selected.some((t) => t.id === teacher.id);
    const next = isSelected
      ? selected.filter((t) => t.id !== teacher.id)
      : [...selected, teacher];
    setSelected(next);
    if (!lead || !next.some((t) => t.id === lead)) {
      setLead(next[0]?.id ?? null);
    }
  };

  const handleSubmit = () => {
    if (!offering || !isDirty) return;
    setError(null);
    setFieldErrors(undefined);
    assignMut.mutate(
      { teacher_ids: selectedIds, lead_teacher_id: lead },
      {
        onSuccess: (updated) => {
          onAssigned({ offeringLabel: updated.label, count: updated.teachers.length });
          onClose();
        },
        onError: (err) => {
          setError(apiErrorMessage(err));
          setFieldErrors(fieldErrorsFrom(err));
        },
      },
    );
  };

  const offeringLabel = offering?.label ?? 'this offering';
  // The API reports both fields against the assignment; show either beside the lead picker.
  const assignmentError =
    fieldErrors?.lead_teacher_id?.[0] ?? fieldErrors?.teacher_ids?.[0] ?? null;

  const submitLabel = willClearAll
    ? 'Remove all lecturers'
    : selected.length > 0
      ? `Save ${selected.length} lecturer${selected.length > 1 ? 's' : ''}`
      : 'Save lecturers';

  return (
    <FormDialog
      open={open}
      title={`Lecturers for ${offeringLabel}`}
      submitLabel={submitLabel}
      submitting={assignMut.isPending}
      submitDisabled={!isDirty}
      error={error}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {selected.length > 0 ? (
        <FormControl
          component="fieldset"
          variant="standard"
          error={Boolean(assignmentError)}
          sx={{ display: 'block', mb: 1 }}
        >
          <FormLabel component="legend" sx={{ typography: 'subtitle2' }}>
            Assigned ({selected.length}) — choose the lead lecturer
          </FormLabel>
          <RadioGroup value={lead ?? ''} onChange={(e) => setLead(e.target.value)}>
            {selected.map((t) => (
              <Box
                key={t.id}
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
              >
                <FormControlLabel
                  value={t.id}
                  control={<Radio size="small" />}
                  label={t.full_name}
                  slotProps={{ typography: { variant: 'body2' } }}
                />
                <IconButton
                  size="small"
                  aria-label={`Remove ${t.full_name} from ${offeringLabel}`}
                  onClick={() => toggle(t)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </RadioGroup>
          {assignmentError && <FormHelperText>{assignmentError}</FormHelperText>}
        </FormControl>
      ) : willClearAll ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Saving now removes every lecturer from {offeringLabel}. It will show as “Needs
          lecturer” until someone is assigned again.
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No lecturer is assigned to {offeringLabel} yet. Select one or more below — the first
          one you pick becomes the lead.
        </Typography>
      )}

      <Divider sx={{ mb: 2 }} />

      <TextField
        label="Search lecturers"
        type="search"
        size="small"
        fullWidth
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or staff number…"
        sx={{ mb: 1 }}
      />

      {listQuery.isError ? (
        <Typography role="alert" color="error" variant="body2" sx={{ py: 2 }}>
          Could not load lecturers. Please try again.
        </Typography>
      ) : listQuery.isLoading ? (
        <LoadingState variant="form" rows={4} label="Loading lecturers" />
      ) : teachers.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? 'No matching lecturers' : 'No active lecturers'}
          description={
            debouncedSearch
              ? 'Try a different name or staff number.'
              : 'Add a lecturer in the Lecturers module before staffing this offering.'
          }
          variant="card"
        />
      ) : (
        <>
          <List dense aria-label={`Lecturers available for ${offeringLabel}`}>
            {teachers.map((t) => {
              const checked = selected.some((s) => s.id === t.id);
              return (
                <ListItemButton
                  key={t.id}
                  onClick={() =>
                    toggle({ id: t.id, staff_number: t.staff_number, full_name: t.full_name })
                  }
                  role="checkbox"
                  aria-checked={checked}
                  selected={checked}
                >
                  <Checkbox
                    edge="start"
                    checked={checked}
                    tabIndex={-1}
                    disableRipple
                    inputProps={{ 'aria-label': `Select ${t.full_name}` }}
                  />
                  <ListItemText
                    primary={t.full_name}
                    secondary={
                      t.subject_specializations.length > 0
                        ? `${t.staff_number} · ${t.subject_specializations.join(', ')}`
                        : t.staff_number
                    }
                  />
                </ListItemButton>
              );
            })}
          </List>

          {totalPages > 1 && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography variant="caption" color="text.secondary" aria-live="polite">
                Showing {rangeStart}–{rangeEnd} of {total}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <IconButton
                  size="small"
                  aria-label="Previous page of lecturers"
                  disabled={page === 0 || listQuery.isFetching}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Next page of lecturers"
                  disabled={page >= totalPages - 1 || listQuery.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          )}
        </>
      )}
    </FormDialog>
  );
}

export default AssignTeachersDialog;
