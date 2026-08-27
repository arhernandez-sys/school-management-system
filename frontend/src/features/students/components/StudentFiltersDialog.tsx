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
import { YearSelect } from '@shared/components';
import type { YearOption } from '@shared/hooks/useYearFilter';
import { strings } from '@i18n/strings';
import { GENDERS, GENDER_LABEL } from '@shared/types/enums';
import type { StudentStatus } from '@shared/types/enums';
import { STUDENT_STATUS_LABEL } from '../constants';
import { EMPTY_STUDENT_FILTERS, activeStudentFilterCount } from './studentFilters';
import type { StudentFilterValues } from './studentFilters';
import { YEAR_OF_STUDY_OPTIONS } from '../hooks/useOfferingOptions';

export interface StudentFiltersDialogProps {
  open: boolean;
  value: StudentFilterValues;
  /** Committed on Apply, not per-keystroke — see the note on `draft` below. */
  onApply: (next: StudentFilterValues) => void;
  onClose: () => void;
  years: YearOption[];
  activeYearId?: string;
  yearsLoading?: boolean;
  religionOptions: string[];
  programOptions: { id: string; code: string; name: string }[];
  offeringOptions: { id: string; label: string; course_name?: string | null }[];
  offeringsLoading?: boolean;
}

/**
 * StudentFiltersDialog — the students directory's filters, in a modal (D33, client ask 1).
 *
 * **Why this replaced the inline row.** D32 took the `FilterBar` from three controls to
 * eight (year · status · year of study · gender · religion · programme · offering, plus
 * search). `FilterBar` lays its children out as a single `flex-direction: row` at `sm` and
 * up, so those eight either squeezed below their `minWidth` or wrapped into a ragged block
 * that pushed the table off the fold; on a phone they stacked into eight full-width selects
 * the user had to scroll past *before reaching a single student*. A modal is the honest fix:
 * the filters are an occasional, deliberate act, and the list is what the page is for.
 *
 * **The draft is local and only commits on Apply.** Each filter change used to fire its own
 * query — pick a programme, then a gender, and the server answered twice for a question the
 * user was still in the middle of asking. Batching them also makes Cancel mean something.
 *
 * Full screen below `sm`, two columns from `sm` up.
 */
export function StudentFiltersDialog({
  open,
  value,
  onApply,
  onClose,
  years,
  activeYearId,
  yearsLoading,
  religionOptions,
  programOptions,
  offeringOptions,
  offeringsLoading,
}: StudentFiltersDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [draft, setDraft] = useState<StudentFilterValues>(value);

  // Re-seed from the committed value every time the dialog opens, so an abandoned edit
  // does not reappear the next time it is opened.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const set = <K extends keyof StudentFilterValues>(key: K, next: StudentFilterValues[K]) =>
    setDraft((prev) => ({ ...prev, [key]: next }));

  const appliedCount = activeStudentFilterCount(draft, { activeYearId });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="student-filters-title"
    >
      <DialogTitle
        id="student-filters-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}
      >
        <Box sx={{ flexGrow: 1 }}>Filter students</Box>
        <IconButton onClick={onClose} aria-label="Close filters" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filters combine — every one you set narrows the list further.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
          }}
        >
          {/* D38 — `allowAll` so the directory can show the whole register rather than
              only the selected year's students. */}
          <YearSelect
            value={draft.yearId}
            onChange={(id) => set('yearId', id)}
            years={years}
            activeYearId={activeYearId}
            isLoading={yearsLoading}
            fullWidth
            allowAll
          />

          <TextField
            select
            size="small"
            label="Status"
            value={draft.status}
            onChange={(e) => set('status', e.target.value as StudentStatus | '')}
            fullWidth
          >
            <MenuItem value="">All statuses</MenuItem>
            {(Object.keys(STUDENT_STATUS_LABEL) as StudentStatus[]).map((st) => (
              <MenuItem key={st} value={st}>
                {STUDENT_STATUS_LABEL[st]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Year of study"
            value={draft.yearOfStudy}
            onChange={(e) => set('yearOfStudy', e.target.value)}
            fullWidth
          >
            {/* Two fixed values, not a derived list — `year_of_study` is a server-side
                enum, so there is nothing to discover from the directory. */}
            <MenuItem value="">All years</MenuItem>
            {YEAR_OF_STUDY_OPTIONS.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Gender"
            value={draft.gender}
            onChange={(e) => set('gender', e.target.value)}
            fullWidth
          >
            {/* A fixed pair, from the one shared vocabulary (D37). The forms only ever
                write these two and the server folds anything else onto them, so there is
                nothing to discover from the directory. */}
            <MenuItem value="">All genders</MenuItem>
            {GENDERS.map((option) => (
              <MenuItem key={option} value={option}>
                {GENDER_LABEL[option]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Religion"
            value={draft.religion}
            onChange={(e) => set('religion', e.target.value)}
            fullWidth
            helperText={religionOptions.length === 0 ? 'None recorded yet' : undefined}
          >
            {/* DISCOVERED, not hardcoded: religion is free text on the admissions form
                (D32). Empty until admissions has run, which is why the helper text says
                so rather than showing an empty menu with no explanation. */}
            <MenuItem value="">All religions</MenuItem>
            {religionOptions.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Programme"
            value={draft.programId}
            onChange={(e) => set('programId', e.target.value)}
            fullWidth
          >
            <MenuItem value="">All programmes</MenuItem>
            {programOptions.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.code} — {p.name}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
            <TextField
              select
              size="small"
              label={strings.terms.courseOffering}
              value={draft.offeringId}
              onChange={(e) => set('offeringId', e.target.value)}
              disabled={offeringsLoading}
              fullWidth
            >
              <MenuItem value="">All offerings</MenuItem>
              {offeringOptions.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.course_name ? `${o.label} — ${o.course_name}` : o.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
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
        <Button
          onClick={() => setDraft({ ...EMPTY_STUDENT_FILTERS, yearId: activeYearId })}
          disabled={appliedCount === 0}
        >
          Clear all
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onApply(draft)}>
          {appliedCount > 0 ? `Apply ${appliedCount} filter${appliedCount === 1 ? '' : 's'}` : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default StudentFiltersDialog;
