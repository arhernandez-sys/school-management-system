import { useEffect, useState } from 'react';
import { Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import type { SubjectListItem } from '@shared/api/generated/model';

export interface SubjectFormValues {
  name: string;
  code: string;
}

export interface SubjectFormDialogProps {
  open: boolean;
  /** When provided, the dialog is in edit mode. */
  subject?: SubjectListItem | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: SubjectFormValues) => void;
  onClose: () => void;
}

/**
 * Create / edit a subject (api-spec §5b). Local controlled state (the form is tiny —
 * name + optional code); the parent owns the mutation and passes submitting/error so a
 * 409 duplicate_subject_name / duplicate_subject_code surfaces at the top of the dialog
 * and, if the server returns field errors, inline on the matching field.
 */
export function SubjectFormDialog({
  open,
  subject,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: SubjectFormDialogProps) {
  const editing = Boolean(subject);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Reset local state whenever the dialog (re)opens for a given subject.
  useEffect(() => {
    if (open) {
      setName(subject?.name ?? '');
      setCode(subject?.code ?? '');
    }
  }, [open, subject]);

  const nameErrors = fieldErrors?.name;
  const codeErrors = fieldErrors?.code;

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit subject' : 'Add subject'}
      submitLabel={editing ? 'Save changes' : 'Create subject'}
      submitting={submitting}
      submitDisabled={name.trim().length === 0}
      error={error}
      onClose={onClose}
      onSubmit={() => onSubmit({ name: name.trim(), code: code.trim() })}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Subject name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          fullWidth
          autoFocus
          inputProps={{ maxLength: 120, 'aria-required': true }}
          error={Boolean(nameErrors)}
          helperText={nameErrors?.join(' ') ?? 'Required'}
        />
        <TextField
          label="Code (optional)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          fullWidth
          error={Boolean(codeErrors)}
          helperText={codeErrors?.join(' ') ?? 'Short code, e.g. MATH or ENG101.'}
          inputProps={{ maxLength: 40 }}
        />
      </Stack>
    </FormDialog>
  );
}

export default SubjectFormDialog;
