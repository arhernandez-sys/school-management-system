import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Checkbox,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { FormDialog, LoadingState, EmptyState } from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useEnrollableStudents, useEnrollStudents } from '../hooks/useClasses';

/**
 * Enroll students into a section (api-spec §5 POST /classes/{id}/enrollments).
 * P/S only (the caller gates rendering). Multi-select from the section's enrollable
 * students (active, not already on the roster). Capacity is warn-only (D-Q6): the
 * enroll always succeeds — an over-capacity result is surfaced to the caller via
 * onEnrolled so the page can toast a non-blocking warning.
 */
export interface EnrollStudentsDialogProps {
  open: boolean;
  classId: string;
  className: string;
  onClose: () => void;
  /** Called after a successful enroll; `overCapacity` drives a warn-only toast upstream. */
  onEnrolled: (result: { count: number; overCapacity: boolean }) => void;
}

export function EnrollStudentsDialog({
  open,
  classId,
  className,
  onClose,
  onEnrolled,
}: EnrollStudentsDialogProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const listQuery = useEnrollableStudents(classId, debouncedSearch, open);
  const enrollMut = useEnrollStudents(classId);

  // Reset transient state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(new Set());
      setError(null);
    }
  }, [open]);

  // Cap the type-ahead result list to the top 5 matches (the hook has no page_size param).
  const students = (listQuery.data ?? []).slice(0, 5);
  const selectedCount = selected.size;

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
    setError(null);
    enrollMut.mutate(Array.from(selected), {
      onSuccess: (result) => {
        onEnrolled({ count: result.enrolled.length, overCapacity: result.over_capacity_warning });
        onClose();
      },
      onError: (err) => setError(apiErrorMessage(err)),
    });
  };

  const listId = useMemo(() => `enrollable-${classId}`, [classId]);

  return (
    <FormDialog
      open={open}
      title={`Add students to ${className}`}
      submitLabel={selectedCount > 0 ? `Add ${selectedCount} student${selectedCount > 1 ? 's' : ''}` : 'Add students'}
      submitting={enrollMut.isPending}
      submitDisabled={selectedCount === 0}
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
              : 'Every active student is already enrolled in this section.'
          }
          variant="card"
        />
      ) : (
        <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
          <List dense aria-label={`Enrollable students for ${className}`} id={listId}>
            {students.map((s) => {
              const checked = selected.has(s.id);
              return (
                <ListItemButton
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  role="checkbox"
                  aria-checked={checked}
                  selected={checked}
                >
                  <Checkbox
                    edge="start"
                    checked={checked}
                    tabIndex={-1}
                    disableRipple
                    inputProps={{ 'aria-label': `Select ${s.full_name}` }}
                  />
                  <ListItemText primary={s.full_name} secondary={s.student_number} />
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
