import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import {
  useAddProgramCourse,
  useProgram,
  useRemoveProgramCourse,
  useUpdateProgramCourse,
} from './hooks/usePrograms';
import {
  ProgramCourseDialog,
  type ProgramCourseFormValues,
} from './components/ProgramCourseDialog';
import { ProgramHeadsCard } from './components/ProgramHeadsCard';
import type { ProgramCourseItem, TermBlock } from './types';

/**
 * THE CURRICULUM BUILDER (D30 §D3) — programme → term block → course.
 *
 * This is the structure the whole BAJC course-sequence PDF lives in, and before D30
 * there was nowhere to put it: `programs` and `courses` had no relationship at all.
 *
 * ⚠️ A BLOCK IS A CURRICULUM POSITION, NOT A CALENDAR TERM. "Semester 1" here means
 * "the first semester of this programme's plan", not any dated row in the academic
 * structure. The blocks are neither uniform across programmes nor limited to two, and
 * "Spring 1" sorts before "Summer 1" alphabetically — which is exactly why the server
 * orders them by an explicit `term_order` rather than by the label.
 *
 * Every write returns the whole programme, so the credit totals shown here are always
 * the server's and never recomputed in the browser.
 */
export function ProgramCurriculumScreen() {
  const { programId } = useParams<{ programId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'programs') : false;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const query = useProgram(programId);
  const addMut = useAddProgramCourse(programId ?? '');
  const updateMut = useUpdateProgramCourse(programId ?? '');
  const removeMut = useRemoveProgramCourse(programId ?? '');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramCourseItem | null>(null);
  const [editingBlock, setEditingBlock] = useState<TermBlock | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  const [removeTarget, setRemoveTarget] = useState<ProgramCourseItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (query.isLoading) return <LoadingState variant="cards" rows={3} />;
  if (query.isError || !query.data) {
    return <ErrorState onRetry={() => void query.refetch()} />;
  }

  const program = query.data;
  const usedCourseIds = program.curriculum.flatMap((b) => b.courses.map((c) => c.course.id));
  const declared = program.total_credits;
  const shortfall = declared != null ? declared - program.curriculum_credits : null;

  const openAdd = (block?: TermBlock) => {
    setEditing(null);
    setEditingBlock(block ?? null);
    setFormError(null);
    setFormFieldErrors({});
    setDialogOpen(true);
  };

  const openMove = (entry: ProgramCourseItem, block: TermBlock) => {
    setEditing(entry);
    setEditingBlock(block);
    setFormError(null);
    setFormFieldErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (values: ProgramCourseFormValues) => {
    setFormError(null);
    setFormFieldErrors({});
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editing) {
      updateMut.mutate(
        {
          programCourseId: editing.id,
          body: {
            term_label: values.term_label,
            term_order: values.term_order,
            is_required: values.is_required,
          },
        },
        { onSuccess: () => setDialogOpen(false), onError },
      );
    } else {
      addMut.mutate(values, { onSuccess: () => setDialogOpen(false), onError });
    }
  };

  const handleRemove = () => {
    if (!removeTarget) return;
    setRemoveError(null);
    removeMut.mutate(removeTarget.id, {
      onSuccess: () => setRemoveTarget(null),
      onError: (err) => setRemoveError(apiErrorMessage(err)),
    });
  };

  const courseActions = (entry: ProgramCourseItem, block: TermBlock) => (
    <>
      <Tooltip title="Move to another block">
        <IconButton
          size="small"
          aria-label={`Move ${entry.course.code}`}
          onClick={() => openMove(entry, block)}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Remove from this programme">
        <IconButton
          size="small"
          color="error"
          aria-label={`Remove ${entry.course.code}`}
          onClick={() => {
            setRemoveError(null);
            setRemoveTarget(entry);
          }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  );

  return (
    <>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(`${ROUTES.settings}/programs`)}
        sx={{ mb: 1 }}
      >
        All programmes
      </Button>

      <PageHeader
        title={`${program.code} — ${program.name}`}
        subtitle={
          [
            program.award,
            `${program.curriculum_credits} credit${program.curriculum_credits === 1 ? '' : 's'} entered${
              declared != null ? ` of ${declared}` : ''
            }`,
            `Pass mark ${Number(program.min_passing_grade_point).toFixed(2)}`,
          ]
            .filter(Boolean)
            .join(' · ')
        }
        primaryAction={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openAdd()}>
              Add course
            </Button>
          ) : undefined
        }
      />

      {/* D43 — who runs this programme. Above the retirement notice and the credit
          shortfall because it is a fact about the programme itself, not a warning. */}
      <ProgramHeadsCard programId={program.id} canManage={canManage} />

      {!program.is_active && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This programme is retired. Its plan is kept for the students who followed it; no
          new student can be enrolled onto it.
        </Alert>
      )}

      {shortfall != null && shortfall !== 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The entered sequence comes to {program.curriculum_credits} credits, but this
          programme declares {declared}.{' '}
          {shortfall > 0
            ? `${shortfall} credit${shortfall === 1 ? '' : 's'} still to add.`
            : `That is ${-shortfall} more than declared — check the sequence, or the declared total.`}
        </Alert>
      )}

      {program.curriculum.length === 0 ? (
        <Alert severity="info">
          No courses in this programme yet. Add them block by block — “Summer 1”,
          “Semester 1”, and so on. A block is a position in the plan, not a dated term.
        </Alert>
      ) : (
        <Stack spacing={2}>
          {program.curriculum.map((block) => (
            <Card key={`${block.term_order}-${block.term_label}`} variant="outlined">
              <CardContent>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ sm: 'center' }}
                  sx={{ mb: 1 }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h4" component="h2">
                      {block.term_label}
                    </Typography>
                    <Chip size="small" label={`${block.credits} cr`} />
                  </Stack>
                  {canManage && (
                    <Button size="small" startIcon={<AddIcon />} onClick={() => openAdd(block)}>
                      Add to this block
                    </Button>
                  )}
                </Stack>
                <Divider sx={{ mb: 1 }} />

                {isMobile ? (
                  <Stack
                    component="ul"
                    spacing={1.5}
                    sx={{ listStyle: 'none', p: 0, m: 0 }}
                    aria-label={`Courses in ${block.term_label}`}
                  >
                    {block.courses.map((entry) => (
                      <Card key={entry.id} component="li" variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {entry.course.code}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            {entry.course.name}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" label={`${entry.course.credits} cr`} />
                            {entry.course.component && (
                              <Chip size="small" label={entry.course.component} />
                            )}
                            {!entry.is_required && (
                              <StatusBadge label="Elective" kind="neutral" />
                            )}
                          </Stack>
                          {canManage && (
                            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                              {courseActions(entry, block)}
                            </Box>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                ) : (
                  <Table size="small" aria-label={`Courses in ${block.term_label}`}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Code</TableCell>
                        <TableCell>Course</TableCell>
                        <TableCell align="right">Credits</TableCell>
                        <TableCell>Component</TableCell>
                        <TableCell>Requirement</TableCell>
                        {canManage && <TableCell align="right" />}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {block.courses.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell sx={{ fontWeight: 600 }}>{entry.course.code}</TableCell>
                          <TableCell>{entry.course.name}</TableCell>
                          <TableCell align="right">{entry.course.credits}</TableCell>
                          <TableCell>
                            {entry.course.component ?? (
                              <Typography variant="body2" color="text.disabled">
                                —
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.is_required ? (
                              <StatusBadge label="Required" kind="success" />
                            ) : (
                              <StatusBadge label="Elective" kind="neutral" />
                            )}
                          </TableCell>
                          {canManage && (
                            <TableCell align="right">{courseActions(entry, block)}</TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <ProgramCourseDialog
        open={dialogOpen}
        entry={editing}
        entryBlock={editingBlock}
        blocks={program.curriculum}
        usedCourseIds={usedCourseIds}
        submitting={addMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleSubmit}
        onClose={() => setDialogOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove course from programme?"
        destructive
        description={
          removeTarget
            ? `Remove "${removeTarget.course.code} — ${removeTarget.course.name}" from this programme's plan? The course stays in the catalog, and no student's enrolment or grade history is touched.`
            : undefined
        }
        confirmLabel="Remove"
        pending={removeMut.isPending}
        error={removeError}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}

export default ProgramCurriculumScreen;
