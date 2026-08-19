import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { LoadingState } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useSubjectsList } from '../hooks/useSubjects';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import {
  useAddPrerequisite,
  usePrerequisites,
  useRemovePrerequisite,
} from '../hooks/usePrerequisites';
import type { SubjectListItem } from '@shared/api/generated/model';
import type { PrerequisiteType } from '../types.prerequisites';

export interface PrerequisitesDialogProps {
  open: boolean;
  course: SubjectListItem | null;
  /** False for the Registrar — the list renders read-only. */
  canManage: boolean;
  onClose: () => void;
}

/**
 * What a course REQUIRES (D30 §D4). Dean-only to edit.
 *
 * This replaces `courses.prerequisites varchar(50)` — free text with no FK, which
 * could hold `AGRI2118 ← AGRI1108, AGRI1109` but not
 * `EDUC2305 ← EDUC1210, 2226, 2228, 2330, 2334, 2336`, and could not express
 * `EDUC3201 ← ALL COURSES` at all. The old string is still shown, as the source it
 * came from — but it is documentation. **The gate reads the relation.**
 *
 * The two kinds are genuinely different requirements, not a UI convenience:
 *  - **Course** — a named course must have been passed.
 *  - **All courses in a programme** — the Internship gate. It keeps meaning
 *    "everything the programme requires" as the curriculum changes, which a fixed
 *    list of courses could never do.
 *
 * There is no edit: a requirement's three fields ARE its identity, so changing one is
 * removing it and adding another, and doing that silently would hide the change from
 * anyone reading the requirement.
 */
export function PrerequisitesDialog({
  open,
  course,
  canManage,
  onClose,
}: PrerequisitesDialogProps) {
  const courseId = course?.id;
  const query = usePrerequisites(open ? courseId : undefined);
  const addMut = useAddPrerequisite(courseId ?? '');
  const removeMut = useRemovePrerequisite(courseId ?? '');

  const catalog = useSubjectsList({ page: 1, page_size: 100, sort: 'code', is_active: true });
  const programs = useProgramsList({ page: 1, page_size: 100, sort: 'code' });

  const [kind, setKind] = useState<PrerequisiteType>('course');
  const [requiredId, setRequiredId] = useState('');
  const [programId, setProgramId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind('course');
      setRequiredId('');
      setProgramId('');
      setError(null);
    }
  }, [open, courseId]);

  const items = query.data?.items ?? [];
  // Already-required courses and the course itself are hidden from the picker: the
  // API rejects both (duplicate_prerequisite, and a course cannot require itself).
  const taken = items.map((i) => i.prerequisite_course?.id).filter(Boolean) as string[];
  const options = useMemo(
    () =>
      (catalog.data?.items ?? []).filter(
        (c) => c.id !== courseId && !taken.includes(c.id),
      ),
    [catalog.data, courseId, taken],
  );
  const selected = options.find((c) => c.id === requiredId) ?? null;

  const canSubmit =
    kind === 'course' ? Boolean(requiredId) : Boolean(programId);

  const handleAdd = () => {
    setError(null);
    addMut.mutate(
      kind === 'course'
        ? { requirement_type: 'course', prerequisite_course_id: requiredId,
            program_id: programId || null }
        : { requirement_type: 'all_program_courses', program_id: programId },
      {
        onSuccess: () => {
          setRequiredId('');
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Prerequisites
        {course && (
          <Typography variant="body2" color="text.secondary">
            {course.code} — {course.name}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {query.isLoading ? (
          <LoadingState variant="cards" rows={2} />
        ) : (
          <Stack spacing={2}>
            {error && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}

            {items.length === 0 ? (
              <Alert severity="info">
                No prerequisites. Any student may enrol in this course.
              </Alert>
            ) : (
              <List dense disablePadding>
                {items.map((item) => (
                  <ListItem
                    key={item.id}
                    divider
                    secondaryAction={
                      canManage ? (
                        <Tooltip title="Remove">
                          <IconButton
                            edge="end"
                            size="small"
                            color="error"
                            aria-label={`Remove ${
                              item.prerequisite_course?.code ?? 'requirement'
                            }`}
                            onClick={() =>
                              removeMut.mutate(item.id, {
                                onError: (err) => setError(apiErrorMessage(err)),
                              })
                            }
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : undefined
                    }
                  >
                    <ListItemText
                      primary={
                        item.requirement_type === 'all_program_courses'
                          ? `All required courses in ${item.program?.code ?? '—'}`
                          : `${item.prerequisite_course?.code} — ${item.prerequisite_course?.name}`
                      }
                      secondary={
                        item.requirement_type === 'all_program_courses'
                          ? 'The whole programme must be completed first.'
                          : item.program
                            ? `Only for students on ${item.program.code}.`
                            : 'Applies wherever this course is taken.'
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}

            {query.data?.prerequisites_text && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  From the course sequence (reference only — the list above is what is
                  enforced)
                </Typography>
                <Typography variant="body2">{query.data.prerequisites_text}</Typography>
              </Box>
            )}

            {canManage && (
              <>
                <Divider>Add a requirement</Divider>
                <TextField
                  select
                  label="Requirement"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as PrerequisiteType)}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="course">A specific course must be passed</MenuItem>
                  <MenuItem value="all_program_courses">
                    Every required course in a programme
                  </MenuItem>
                </TextField>

                {kind === 'course' && (
                  <Autocomplete
                    options={options}
                    value={selected}
                    onChange={(_e, next) => setRequiredId(next?.id ?? '')}
                    getOptionLabel={(c) => `${c.code} — ${c.name}`}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    loading={catalog.isLoading}
                    size="small"
                    renderInput={(params) => (
                      <TextField {...params} label="Required course" required />
                    )}
                  />
                )}

                <TextField
                  select
                  label={kind === 'course' ? 'Only in this programme (optional)' : 'Programme'}
                  value={programId}
                  onChange={(e) => setProgramId(e.target.value)}
                  fullWidth
                  size="small"
                  required={kind === 'all_program_courses'}
                  helperText={
                    kind === 'course'
                      ? 'Leave blank to require it wherever this course is taken.'
                      : '“Every course in the programme” needs to say which programme.'
                  }
                >
                  {kind === 'course' && (
                    <MenuItem value="">
                      <em>Every programme</em>
                    </MenuItem>
                  )}
                  {(programs.data?.items ?? []).map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </MenuItem>
                  ))}
                </TextField>

                <Box>
                  <Button
                    startIcon={<AddIcon />}
                    onClick={handleAdd}
                    disabled={!canSubmit || addMut.isPending}
                  >
                    Add requirement
                  </Button>
                </Box>

                <Alert severity="info" variant="outlined">
                  A prerequisite is met only by <strong>passing</strong> the course —
                  judged against the student&apos;s programme pass mark. Having taken it
                  is not enough, and neither is taking it in the same term.
                </Alert>
              </>
            )}

            {!canManage && items.length > 0 && (
              <Chip size="small" label="Only the Dean can change prerequisites" />
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default PrerequisitesDialog;
