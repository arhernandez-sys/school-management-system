import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useSubjectsList } from '@features/settings/hooks/useSubjects';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAttachSubject } from '../hooks/useClasses';
import type { ClassSubjectItem } from '../types';

/**
 * Class detail → Subjects tab → "Add subject" (POST /classes/{id}/subjects).
 *
 * Attaching a subject creates the `class_subject` offering, which is the unit
 * everything downstream hangs off: teachers are assigned to it, the gradebook is
 * addressed by it, and assessments belong to it. A section with no offerings is
 * inert — which is why this dialog is the first step when setting up a new year.
 *
 * Subjects already offered in this section are filtered out of the picker rather
 * than left selectable-and-rejected: the API answers 409 for a duplicate, and a
 * choice the server will always refuse should not be offered in the first place.
 */
export interface AddSubjectDialogProps {
  open: boolean;
  classId: string;
  /** Offerings already on the section — used to exclude duplicates from the picker. */
  existing: ClassSubjectItem[];
  onClose: () => void;
  onAdded: (subjectName: string) => void;
}

interface SubjectOption {
  id: string;
  name: string;
  code: string;
}

export function AddSubjectDialog({
  open,
  classId,
  existing,
  onClose,
  onAdded,
}: AddSubjectDialogProps) {
  const [selected, setSelected] = useState<SubjectOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attach = useAttachSubject(classId);

  // Only fetch while the dialog is open — same `enabled` convention the other
  // dialogs in this feature use. `page_size` is the API max so the picker holds the
  // whole catalogue in one page; a school's subject list is small and bounded, and
  // Autocomplete filters client-side.
  const subjectsQuery = useSubjectsList({ page: 1, page_size: 200, is_active: true });

  const alreadyOffered = useMemo(
    () => new Set(existing.map((cs) => cs.subject.id)),
    [existing],
  );

  const options = useMemo<SubjectOption[]>(() => {
    const items = subjectsQuery.data?.items ?? [];
    return items
      .filter((s) => !alreadyOffered.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, code: s.code ?? '' }));
  }, [subjectsQuery.data, alreadyOffered]);

  const close = () => {
    setSelected(null);
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!selected) return;
    setError(null);
    try {
      await attach.mutateAsync(selected.id);
      onAdded(selected.name);
      close();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const nothingLeft = !subjectsQuery.isLoading && options.length === 0;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="add-subject-title">
      <DialogTitle id="add-subject-title">Add a subject to this section</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <DialogContentText>
            The subject becomes an offering in this section, with its own gradebook and
            teacher assignment.
          </DialogContentText>

          {error && <Alert severity="error">{error}</Alert>}

          {subjectsQuery.isError && (
            <Alert severity="error">
              Could not load the subject list. Close this dialog and try again.
            </Alert>
          )}

          {nothingLeft && !subjectsQuery.isError && (
            <Alert severity="info">
              {existing.length > 0
                ? 'Every active subject is already offered in this section.'
                : 'There are no active subjects yet. Add subjects under Settings first.'}
            </Alert>
          )}

          <Autocomplete<SubjectOption>
            options={options}
            value={selected}
            onChange={(_e, value) => setSelected(value)}
            loading={subjectsQuery.isLoading}
            disabled={nothingLeft || subjectsQuery.isError}
            getOptionLabel={(o) => (o.code ? `${o.name} (${o.code})` : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Subject"
                placeholder="Search subjects…"
                autoFocus
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={attach.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={!selected || attach.isPending}
        >
          {attach.isPending ? 'Adding…' : 'Add subject'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddSubjectDialog;
