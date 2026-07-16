import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Slide,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { GradeCell, type GradeCellValue } from './components/GradeCell';
import { useGradebook, useSaveGrades, useSetRelease } from './hooks/useGrades';
import type { GradeEntry } from './types';

/**
 * Per-assessment class grading page (`/grades/assessment/:assessmentId`).
 *
 * Reached from the assessment list: instead of the full students×assessments grid, the
 * teacher grades the WHOLE CLASS for a SINGLE assessment. Reuses the gradebook read
 * (roster + existing marks), filters to this one assessment's column, and saves via the
 * one grade-write path (PUT /assessments/{id}/grades). P/S see it read-only; a teacher
 * who does not own the offering gets a clean not-authorized state (the gradebook 404s).
 */
export function AssessmentGradingScreen() {
  const navigate = useNavigate();
  const { assessmentId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const classSubjectId = searchParams.get('class_subject_id');

  const gradebookQuery = useGradebook(classSubjectId);
  const saveMut = useSaveGrades(classSubjectId);
  const releaseMut = useSetRelease(classSubjectId);

  const [draft, setDraft] = useState<Map<string, GradeCellValue>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset the draft whenever the target assessment changes.
  useEffect(() => {
    setDraft(new Map());
    setSaveError(null);
  }, [assessmentId, classSubjectId]);

  const gradebook = gradebookQuery.data;
  const assessment = useMemo(
    () => gradebook?.assessments.find((a) => a.id === assessmentId) ?? null,
    [gradebook, assessmentId],
  );
  const canEdit = (gradebook?.can_edit ?? false) && (assessment?.is_editable ?? false);

  const handleChange = useCallback((studentId: string, next: GradeCellValue) => {
    setDraft((prev) => {
      const map = new Map(prev);
      map.set(studentId, next);
      return map;
    });
  }, []);

  const dirtyCount = draft.size;

  const saveAll = useCallback(async () => {
    if (!assessment || dirtyCount === 0) return;
    setSaveError(null);
    const entries: GradeEntry[] = [];
    for (const [studentId, value] of draft.entries()) {
      if (value.status === 'graded') {
        if (value.score == null || value.score < 0 || value.score > assessment.max_score) {
          setSaveError(`Fix scores outside 0–${assessment.max_score} before saving.`);
          return;
        }
      }
      entries.push({
        student_id: studentId,
        status: value.status,
        score: value.status === 'graded' ? value.score : null,
      });
    }
    try {
      await saveMut.mutateAsync({ assessmentId, entries });
      setDraft(new Map());
    } catch (err) {
      setSaveError(apiErrorMessage(err));
    }
  }, [assessment, assessmentId, draft, dirtyCount, saveMut]);

  const backToList = () => navigate(ROUTES.grades);

  // ── Guard states ─────────────────────────────────────────────────────────────────
  if (!classSubjectId) {
    return (
      <Box sx={{ pt: 3 }}>
        <BackButton onClick={backToList} />
        <EmptyState
          variant="page"
          title="No class selected"
          description="Open an assessment from the Grades list to grade its class."
        />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: dirtyCount > 0 ? 10 : 3, pt: 3 }}>
      <BackButton onClick={backToList} />

      {gradebookQuery.isLoading && <LoadingState variant="table" rows={8} label="Loading class" />}

      {gradebookQuery.isError && (
        <ErrorState
          title="You can't grade this class"
          message="This assessment isn't in a class you're assigned to."
          onRetry={() => void gradebookQuery.refetch()}
        />
      )}

      {gradebook && !assessment && (
        <EmptyState
          variant="page"
          title="Assessment not found"
          description="This assessment may have been removed. Go back to the list and pick another."
        />
      )}

      {gradebook && assessment && (
        <>
          <PageHeader
            title={assessment.title}
            subtitle={gradebook.class_subject?.display_name}
            primaryAction={
              canEdit ? (
                <Button
                  variant="outlined"
                  disabled={releaseMut.isPending}
                  onClick={() =>
                    releaseMut.mutate({ assessmentId, release: !assessment.is_released })
                  }
                >
                  {assessment.is_released ? 'Unrelease grades' : 'Release grades'}
                </Button>
              ) : undefined
            }
          />

          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Chip size="small" variant="outlined" label={`Max score ${assessment.max_score}`} />
            {assessment.assessment_date && (
              <Chip size="small" variant="outlined" label={assessment.assessment_date} />
            )}
            <StatusBadge
              label={assessment.is_released ? 'Released' : 'Not released'}
              kind={assessment.is_released ? 'success' : 'neutral'}
            />
            {!canEdit && <StatusBadge label="Read-only" kind="neutral" />}
          </Stack>

          {gradebook.rows.length === 0 ? (
            <EmptyState
              variant="card"
              title="No students enrolled"
              description="This class has no roster members yet."
            />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label={`Grades for ${assessment.title}`}>
                <TableHead>
                  <TableRow>
                    <TableCell>Student</TableCell>
                    <TableCell>Student #</TableCell>
                    <TableCell align="right">{`Grade (out of ${assessment.max_score})`}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {gradebook.rows.map((row) => {
                    const cell = row.cells.find((c) => c.assessment_id === assessmentId);
                    const draftValue = draft.get(row.student.id);
                    const value: GradeCellValue = draftValue ?? {
                      status: cell?.status ?? 'pending',
                      score: cell?.score ?? null,
                    };
                    const rowEditable = canEdit && row.is_active_member;
                    return (
                      <TableRow key={row.student.id} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {row.student.full_name}
                          </Typography>
                          {!row.is_active_member && (
                            <Typography variant="caption" color="text.secondary">
                              Not currently enrolled
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{row.student.student_number}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <GradeCell
                              value={value}
                              maxScore={assessment.max_score}
                              studentName={row.student.full_name}
                              assessmentTitle={assessment.title}
                              editable={rowEditable}
                              dirty={draft.has(row.student.id)}
                              onChange={(next) => handleChange(row.student.id, next)}
                            />
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {/* Sticky save bar — appears only when there are unsaved edits. */}
      <Slide direction="up" in={dirtyCount > 0} mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: (theme) => theme.zIndex.appBar,
            p: 2,
            borderTop: '1px solid',
            borderTopColor: 'divider',
          }}
          role="region"
          aria-label="Unsaved grade changes"
        >
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'flex-end', maxWidth: 1200, mx: 'auto' }}
          >
            {saveError && (
              <Alert severity="error" sx={{ mr: 'auto' }} role="alert">
                {saveError}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>
              <Box component="span" sx={{ color: 'warning.main', fontWeight: 700 }}>
                ●
              </Box>{' '}
              {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
            </Typography>
            <Button
              onClick={() => {
                setDraft(new Map());
                setSaveError(null);
              }}
              disabled={saveMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={() => void saveAll()}
              disabled={saveMut.isPending}
              startIcon={saveMut.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {saveMut.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </Stack>
        </Paper>
      </Slide>
    </Box>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button startIcon={<ArrowBackIcon />} onClick={onClick} sx={{ mb: 1 }}>
      All assessments
    </Button>
  );
}

export default AssessmentGradingScreen;
