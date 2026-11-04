import { Checkbox, FormControlLabel, Stack } from '@mui/material';
import { DOCUMENT_TYPES, type DocumentRow } from '../types';

/**
 * Section F · Documents to submit — the tick-list. One component for the two places it is
 * filled in: the application wizard, and the student record after enrolment (papers keep
 * arriving once a student is accepted). Both write the SAME rows on the application.
 *
 * Ticking a type the list has no row for adds one; unticking keeps the row with
 * `received: false`, so its id survives — the server reconciles by id because a credit
 * transfer may cite a row.
 */
export function DocumentChecklist({
  value,
  onChange,
  disabled = false,
}: {
  value: DocumentRow[];
  onChange: (next: DocumentRow[]) => void;
  disabled?: boolean;
}) {
  const toggle = (type: DocumentRow['document_type'], received: boolean) => {
    const found = value.find((d) => d.document_type === type);
    onChange(
      found
        ? value.map((d) => (d.document_type === type ? { ...d, received } : d))
        : [
            ...value,
            { document_type: type, file_name: null, content_type: null, size_bytes: null, received },
          ],
    );
  };

  return (
    <Stack spacing={0.5}>
      {DOCUMENT_TYPES.map((type) => (
        <FormControlLabel
          key={type.value}
          disabled={disabled}
          control={
            <Checkbox
              checked={value.find((d) => d.document_type === type.value)?.received ?? false}
              onChange={(e) => toggle(type.value, e.target.checked)}
            />
          }
          label={type.label}
        />
      ))}
    </Stack>
  );
}

export default DocumentChecklist;
