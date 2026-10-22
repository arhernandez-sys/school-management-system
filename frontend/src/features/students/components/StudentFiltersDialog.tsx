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
import { SearchableSelect, YearSelect } from '@shared/components';
import type { YearOption } from '@shared/hooks/useYearFilter';
import { strings } from '@i18n/strings';
import { CIVIL_STATUSES, GENDERS, GENDER_LABEL } from '@shared/types/enums';
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
  /**
   * The `religions` table's names (D39/D40), already merged with any legacy religion
   * still stored on a student — see `StudentsListPage`, which builds it.
   */
  religionOptions: string[];
  /** Legacy civil statuses present in the register that `CIVIL_STATUSES` omits. */
  legacyCivilStatuses?: string[];
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
  legacyCivilStatuses = [],
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
            helperText={
              religionOptions.length === 0 ? 'No religions configured yet' : undefined
            }
          >
            {/* D40 — the options are the client-owned `religions` table, not the values
                DISCOVERED in the register as they were under D32. The Dean can now filter
                by a religion nobody has been recorded with yet, which is what "show me the
                Methodist students" has to be able to answer before it answers "none".

                The parent merges any religion still stored that the table does not carry,
                so an imported student stays selectable — the column is free text and
                always will be (D37). */}
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
            label="Civil status"
            value={draft.civilStatus}
            onChange={(e) => set('civilStatus', e.target.value)}
            fullWidth
          >
            {/* D40 — a fixed vocabulary, like Gender and unlike Religion: these four are
                the only values the forms write, and the server folds recognised spellings
                onto them. Nothing to discover from the directory. */}
            <MenuItem value="">All civil statuses</MenuItem>
            {CIVIL_STATUSES.map((cs) => (
              <MenuItem key={cs} value={cs}>
                {cs}
              </MenuItem>
            ))}
            {/* A value the register holds that the four do not cover. Offered rather than
                dropped: the column is free text, the Religion column beside it shows such
                a value in the table, and a filter that cannot select what the table
                displays makes those students unfindable. */}
            {legacyCivilStatuses.map((cs) => (
              <MenuItem key={cs} value={cs}>
                {cs} (as recorded)
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
            {/* D43-b — every offering in the year is a long list, and the thing people
                know is the code. Typing it beats scrolling. */}
            <SearchableSelect
              label={strings.terms.courseOffering}
              value={draft.offeringId}
              onChange={(v) => set('offeringId', v)}
              allOption="All offerings"
              options={offeringOptions.map((o) => ({
                value: o.id,
                label: o.course_name ?? o.label,
                hint: o.label,
              }))}
              disabled={offeringsLoading}
              loading={offeringsLoading}
              fullWidth
            />
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
