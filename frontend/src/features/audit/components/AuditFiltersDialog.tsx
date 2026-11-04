import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { DateField } from '@shared/components';
import { EMPTY_AUDIT_FILTERS, activeAuditFilterCount } from './auditFilters';
import type { AuditFilterValues } from './auditFilters';
import type { AuditActorRef, AuditReport } from '../types';

export interface AuditFiltersDialogProps {
  open: boolean;
  value: AuditFilterValues;
  /** Committed on Apply, not per-keystroke. */
  onApply: (next: AuditFilterValues) => void;
  onClose: () => void;
  reports: AuditReport[];
  modules: string[];
  actors: AuditActorRef[];
}

/**
 * AuditFiltersDialog — the audit trail's filters, in a modal.
 *
 * **Why this replaced the inline row (client ask, Sep 2026: "do the audit trail filter
 * as students — search bar + filters button").** The toolbar carried six controls in one
 * `flex-direction: row`: report, area, person, from, to and search. At `sm` and up they
 * squeezed below their `minWidth` or wrapped into a ragged block that pushed the entries
 * below the fold; on a phone they stacked into six full-width controls the reader had to
 * scroll past *before reaching a single audit entry*. That is the identical problem D33
 * solved on the students directory, and this is the identical fix, deliberately built
 * from the same parts so the two screens behave the same way.
 *
 * **The draft is local and only commits on Apply.** Every filter change used to fire its
 * own request — pick a report, then a person, and the server answered twice for a
 * question the auditor was still in the middle of asking. Batching also makes Cancel
 * mean something.
 *
 * Search stays OUT of here, in the toolbar: it is typed continuously and debounced, and
 * putting the most-used control behind an Apply button makes it the slowest one.
 *
 * Full screen below `sm`, two columns from `sm` up.
 */
export function AuditFiltersDialog({
  open,
  value,
  onApply,
  onClose,
  reports,
  modules,
  actors,
}: AuditFiltersDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [draft, setDraft] = useState<AuditFilterValues>(value);

  // Re-seed from the committed value each time it opens, so an abandoned edit does not
  // reappear the next time.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const set = <K extends keyof AuditFilterValues>(key: K, next: AuditFilterValues[K]) =>
    setDraft((prev) => ({ ...prev, [key]: next }));

  const appliedCount = activeAuditFilterCount(draft);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="audit-filters-title"
    >
      <DialogTitle
        id="audit-filters-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}
      >
        <Box sx={{ flexGrow: 1 }}>Filter the audit trail</Box>
        <IconButton onClick={onClose} aria-label="Close filters" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filters combine — every one you set narrows the trail further.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
          }}
        >
          <TextField
            select
            size="small"
            label="Report"
            value={draft.report}
            onChange={(e) => set('report', e.target.value)}
            helperText="The four standard audit reports"
            fullWidth
          >
            <MenuItem value="">All activity</MenuItem>
            {reports.map((r) => (
              <MenuItem key={r.key} value={r.key}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Area"
            value={draft.module}
            onChange={(e) => set('module', e.target.value)}
            helperText="What was being done, not which table"
            fullWidth
          >
            <MenuItem value="">Every area</MenuItem>
            {modules.map((m) => (
              <MenuItem key={m} value={m}>
                {m}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
            <TextField
              select
              size="small"
              label="Done by"
              value={draft.actorUserId}
              onChange={(e) => set('actorUserId', e.target.value)}
              fullWidth
            >
              <MenuItem value="">Anyone</MenuItem>
              {actors.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name}
                  {a.role ? ` (${a.role})` : ''}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* D42 §6 — `DateField` is the app's ONLY date control. It shows dd/mm/yyyy and
              emits YYYY-MM-DD, which is what the API wants; a raw text field here would
              mean hand-parsing the format in a second place. Both ends are INCLUSIVE
              school-local days, which is what an auditor asking for "9 September" means. */}
          <DateField
            size="small"
            label="From"
            value={draft.fromDate}
            onChange={(v) => set('fromDate', v)}
            maxDate={draft.toDate || undefined}
            fullWidth
          />
          <DateField
            size="small"
            label="To"
            value={draft.toDate}
            onChange={(v) => set('toDate', v)}
            minDate={draft.fromDate || undefined}
            fullWidth
          />
        </Box>
      </DialogContent>

      <Divider />
      <DialogActions
        sx={{
          gap: 1,
          ...(fullScreen
            ? { position: 'sticky', bottom: 0, bgcolor: 'background.paper', px: 2, py: 1.5 }
            : null),
        }}
      >
        <Button onClick={() => setDraft(EMPTY_AUDIT_FILTERS)} disabled={appliedCount === 0}>
          Clear all
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply(draft)}>
          {appliedCount > 0
            ? `Apply ${appliedCount} filter${appliedCount === 1 ? '' : 's'}`
            : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AuditFiltersDialog;
