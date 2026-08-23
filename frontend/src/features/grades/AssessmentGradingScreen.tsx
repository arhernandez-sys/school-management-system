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
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditNoteIcon from '@mui/icons-material/EditNote';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useAuth } from '@features/auth/hooks/useAuth';
import { GradeCell, type GradeCellValue } from './components/GradeCell';
import { RequestRevisionDialog } from './components/RequestRevisionDialog';
import { useGradebook, useSaveGrades, useSetRelease } from './hooks/useGrades';
import type { GradeEntry, RevisionBlockedReason } from './types';

/**
 * Tooltip copy per blocked reason (D32, brief §1). Short by design — the server's
 * `REVISION_BLOCKED_REASONS` carries the full explanation for the 422 body; a tooltip that
 * long would be unreadable hovering over a table button.
 */
const REVISION_BLOCKED_COPY: Record<RevisionBlockedReason, string> = {
  no_midterm_window:
    'This term has no mid-term grading period. The Dean sets one in Settings → Academic structure.',
  // D33 — was "correct the mark directly instead", which the freeze made impossible: the
  // window is precisely when a Lecturer cannot type in a mark.
  midterm_window_open:
    'Grades are frozen until the mid-term period closes. Revisions open then.',
  assessment_after_window:
    'This assessment was created after the mid-term period began, so it was never part of it.',
  grade_after_window:
    'This result was first entered after the mid-term period began, so it was not part of the mid-term submission.',
  not_current_semester: 'Only the current semester accepts revisions.',
  not_graded: 'Only a recorded grade can be revised.',
};

/**
 * A stored UTC deadline in the reader's own timezone, to the minute — "grades due on the
 * 15th" and "grades due 17:00 on the 15th" are different instructions, and the second is
 * what is enforced.
 */
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Per-assessment class grading page (`/grades/assessment/:assessmentId`).
 *
 * Reached from the assessment list: instead of the full students×assessments grid, the
 * teacher grades the WHOLE CLASS for a SINGLE assessment. Reuses the gradebook read
 * (roster + existing marks), filters to this one assessment's column, and saves via the
 * one grade-write path (PUT /assessments/{id}/grades). The Dean and Registrar see it
 * read-only; a lecturer who does not own the offering gets a clean not-authorized state
 * (the gradebook 404s — 404, not 403, so the response does not reveal that it exists).
 */
export function AssessmentGradingScreen() {
  const navigate = useNavigate();
  const { assessmentId = '' } = useParams();
  const { user } = useAuth();
  // Only the Lecturer who teaches the offering may request one (§D7); the server
  // enforces ownership and 403s anybody else, so this is UX, not the boundary.
  const isLecturer = user?.role === 'teacher';
  const [searchParams] = useSearchParams();
  const offeringId = searchParams.get('offering_id');

  const gradebookQuery = useGradebook(offeringId);
  const saveMut = useSaveGrades(offeringId);
  const releaseMut = useSetRelease(offeringId);

  const [draft, setDraft] = useState<Map<string, GradeCellValue>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  // D30 §D7 — the student whose grade a revision is being requested for.
  const [revisionFor, setRevisionFor] = useState<{
    id: string;
    full_name: string;
    currentScore: number | null;
  } | null>(null);

  // Reset the draft whenever the target assessment changes.
  useEffect(() => {
    setDraft(new Map());
    setSaveError(null);
  }, [assessmentId, offeringId]);

  const gradebook = gradebookQuery.data;
  const assessment = useMemo(
    () => gradebook?.assessments.find((a) => a.id === assessmentId) ?? null,
    [gradebook, assessmentId],
  );
  // D30 §D6 — the term's grade window. Kept separate from `can_edit` on the wire (a shut
  // deadline and a read-only role are different situations) but folded together HERE,
  // because from the cell's point of view both mean "you cannot type in me".
  const windowClosed = gradebook?.grade_window_closed ?? false;
  const deadline = gradebook?.grade_submission_deadline ?? null;
  /**
   * D33 (client ask 7) — the MID-TERM FREEZE. While
   * `[midterm_submission_start, midterm_submission_end]` is running, nobody enters a grade
   * for this term; the server refuses the write with 409 `midterm_frozen`.
   *
   * A THIRD state, not a synonym for `windowClosed`, because the three have different
   * answers and the Lecturer acts on which one it is:
   *
   *   read-only        → "not your offering"
   *   grading closed   → "the term is over; ask the Dean or file a revision"
   *   mid-term frozen  → "wait — entry reopens on this date"
   *
   * Folded into `canEdit` all the same, because from a cell's point of view all three mean
   * "you cannot type in me".
   */
  const midtermFrozen = gradebook?.midterm_frozen ?? false;
  const midtermEnd = gradebook?.midterm_submission_end ?? null;
  const canEdit =
    (gradebook?.can_edit ?? false) &&
    (assessment?.is_editable ?? false) &&
    !windowClosed &&
    !midtermFrozen;

  /**
   * D32 — is a Revision of Grades possible for ANY student on this assessment?
   *
   * When it is not, the whole column is dropped rather than rendered as a row of disabled
   * buttons. A grid of dead controls reads as "broken", and for the two commonest cases
   * (`no_midterm_window`, `assessment_after_window`) the answer is the same for every
   * student on the assessment — so there is nothing per-row for the Lecturer to learn from
   * seeing forty of them. The banner below says why instead, once.
   */
  const revisionCells = useMemo(
    () =>
      (gradebook?.rows ?? [])
        .map((row) => row.cells.find((c) => c.assessment_id === assessmentId))
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [gradebook, assessmentId],
  );
  const anyRevisable = revisionCells.some((c) => c.can_request_revision);
  /**
   * The single blocking reason, when every cell agrees on one. Assessment- and term-level
   * rules produce that; a mix of "not_graded" and something else does not, and then the
   * banner is suppressed rather than picking a reason arbitrarily.
   */
  const sharedBlockedReason = useMemo(() => {
    if (anyRevisable || revisionCells.length === 0) return null;
    const reasons = new Set(revisionCells.map((c) => c.revision_blocked_reason));
    return reasons.size === 1 ? [...reasons][0] : null;
  }, [anyRevisable, revisionCells]);
  const showRevisionColumn = isLecturer && anyRevisable;

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
  if (!offeringId) {
    return (
      <Box sx={{ pt: 3 }}>
        <BackButton onClick={backToList} />
        <EmptyState
          variant="page"
          title="No offering selected"
          description="Open an assessment from the Grades list to grade the students enrolled in it."
        />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: dirtyCount > 0 ? 10 : 3, pt: 3 }}>
      <BackButton onClick={backToList} />

      {gradebookQuery.isLoading && <LoadingState variant="table" rows={8} label="Loading roster" />}

      {gradebookQuery.isError && (
        <ErrorState
          title="You can't grade this offering"
          message="This assessment isn't in an offering you're assigned to."
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
            subtitle={
              gradebook.offering
                ? [gradebook.offering.offering.label, gradebook.semester?.name]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
            }
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
            {windowClosed && <StatusBadge label="Grading closed" kind="warning" />}
            {midtermFrozen && !windowClosed && (
              <StatusBadge label="Mid-term frozen" kind="warning" />
            )}
            {!canEdit && !windowClosed && !midtermFrozen && (
              <StatusBadge label="Read-only" kind="neutral" />
            )}
            <Box sx={{ flexGrow: 1 }} />
            {isLecturer && (
              <Button size="small" onClick={() => navigate(ROUTES.gradeRevisions)}>
                My revision requests
              </Button>
            )}
          </Stack>

          {/* Explain the disabled form BEFORE the Lecturer types forty marks into it.
              Without this the save bar simply refuses and the only feedback is a 409. */}
          {windowClosed && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Grade submission has closed for this term.</strong>{' '}
              {deadline
                ? `The deadline was ${formatDeadline(deadline)}.`
                : 'The deadline has passed.'}{' '}
              Ask the Dean to reopen the window or to review a grade revision.
            </Alert>
          )}

          {/* D33 ask 7 — the freeze, explained with its REOPEN DATE. "Frozen" on its own
              is unactionable: the Lecturer's next question is always wait-or-file-a-
              revision, and the end date is what answers it. Suppressed when the term's
              own deadline has also passed, because then waiting would not help and the
              banner above is the one that applies. */}
          {midtermFrozen && !windowClosed && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Mid-term grades are frozen.</strong>{' '}
              {midtermEnd
                ? `Grade entry for this term reopens after ${formatDeadline(midtermEnd)}.`
                : 'Grade entry for this term reopens once the mid-term period closes.'}{' '}
              After that you can enter new marks as normal, and request a revision to
              change one that was already recorded.
            </Alert>
          )}

          {/* D32 — say ONCE why the Revision column is absent, rather than rendering forty
              disabled buttons. Only when every cell blocks for the same reason; a mixed
              set has no single explanation and stays quiet. */}
          {isLecturer && sharedBlockedReason && sharedBlockedReason !== 'not_graded' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>Revision of grades is not available for this assessment.</strong>{' '}
              {REVISION_BLOCKED_COPY[sharedBlockedReason]}
            </Alert>
          )}

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
                    {showRevisionColumn && <TableCell align="right">Revision</TableCell>}
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
                        {showRevisionColumn && (
                          <TableCell align="right">
                            {/* Requesting writes no grade, so it stays available when the
                                grade window has CLOSED and the save bar does not — which is
                                the whole point of the workflow (§D7).

                                D32: eligibility is the SERVER's verdict, not re-derived
                                here. The four rules read timestamps this payload does not
                                carry, so a client-side copy could disagree with the
                                endpoint and offer a button that 422s. */}
                            <Tooltip
                              title={
                                cell?.can_request_revision
                                  ? 'Ask the Dean to change this mark. The original is kept.'
                                  : (cell?.revision_blocked_reason
                                      ? REVISION_BLOCKED_COPY[cell.revision_blocked_reason]
                                      : 'This result cannot be revised.')
                              }
                            >
                              <span>
                                <Button
                                  size="small"
                                  startIcon={<EditNoteIcon />}
                                  disabled={!cell?.can_request_revision}
                                  onClick={() =>
                                    setRevisionFor({
                                      id: row.student.id,
                                      full_name: row.student.full_name,
                                      currentScore: cell?.score ?? null,
                                    })
                                  }
                                >
                                  Request
                                </Button>
                              </span>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {assessment && (
        <RequestRevisionDialog
          open={revisionFor !== null}
          assessmentId={assessmentId}
          assessmentTitle={assessment.title}
          maxScore={assessment.max_score}
          student={revisionFor}
          currentScore={revisionFor?.currentScore ?? null}
          windowClosed={windowClosed}
          onClose={() => setRevisionFor(null)}
        />
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
          {/* D33 — WRAPS, and stacks below `sm`. An Alert, a counter and two buttons in one
              non-wrapping row overflowed a phone, which put a horizontal scrollbar on a
              FIXED element: the Save button ended up off-screen with no way to reach it. */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 2 }}
            useFlexGap
            sx={{
              alignItems: { xs: 'stretch', sm: 'center' },
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              maxWidth: 1200,
              mx: 'auto',
            }}
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
              // Also disabled on a closed window OR a frozen mid-term: the cells are
              // already locked, but a draft entered before the deadline lapsed — or before
              // a refetch flipped the freeze on — could otherwise still be submitted into a
              // guaranteed 409. Same argument for both windows (D33).
              disabled={saveMut.isPending || windowClosed || midtermFrozen}
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
