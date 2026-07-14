import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Slide,
  Stack,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ClassSubjectPicker } from './components/ClassSubjectPicker';
import { GradebookGrid } from './components/GradebookGrid';
import { GradeDistributionCard } from './components/GradeDistributionCard';
import { ReleaseControl } from './components/ReleaseControl';
import type { GradeCellValue } from './components/GradeCell';
import { useClassSubjectOptions, useGradebook, useSaveGrades, useSetRelease } from './hooks/useGrades';
import type { GradebookAssessment, GradeEntry } from './types';

const cellKey = (assessmentId: string, studentId: string) => `${assessmentId}:${studentId}`;

/**
 * Gradebook screen (§7.7) — the marquee grade-entry surface.
 *
 * Flow: pick a class·subject (URL-persisted via ?class_subject_id) → the grid loads →
 * a teacher who owns it edits cells (draft held locally, Term column recomputes live) →
 * the sticky save bar bulk-saves per assessment column via PUT /assessments/{id}/grades,
 * then the gradebook refetches so term grades are authoritative. P/S see the same grid
 * read-only. Every UI state (loading / empty / error / no-selection / read-only) handled.
 */
export function GradebookScreen() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('class_subject_id');

  const optionsQuery = useClassSubjectOptions();
  const gradebookQuery = useGradebook(selectedId);
  const saveMut = useSaveGrades(selectedId);
  const releaseMut = useSetRelease(selectedId);

  // Draft edits keyed `${assessmentId}:${studentId}`; cleared on save / selection change.
  const [draft, setDraft] = useState<Map<string, GradeCellValue>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset the draft whenever the selected gradebook changes.
  useEffect(() => {
    setDraft(new Map());
    setSaveError(null);
  }, [selectedId]);

  const options = optionsQuery.data?.items ?? [];
  const selectedOption = useMemo(
    () => options.find((o) => o.id === selectedId) ?? null,
    [options, selectedId],
  );

  // Auto-select the teacher's first gradebook if none is chosen (one-hop to work).
  useEffect(() => {
    if (!selectedId && options.length > 0) {
      const first = options.find((o) => o.can_edit) ?? options[0];
      if (first) {
        setSearchParams({ class_subject_id: first.id }, { replace: true });
      }
    }
  }, [selectedId, options, setSearchParams]);

  const gradebook = gradebookQuery.data;
  const canEdit = gradebook?.can_edit ?? false;

  const handleSelect = useCallback(
    (id: string | null) => {
      if (id) setSearchParams({ class_subject_id: id });
      else setSearchParams({});
    },
    [setSearchParams],
  );

  const handleCellChange = useCallback(
    (assessmentId: string, studentId: string, next: GradeCellValue) => {
      setDraft((prev) => {
        const map = new Map(prev);
        map.set(cellKey(assessmentId, studentId), next);
        return map;
      });
    },
    [],
  );

  const dirtyCount = draft.size;

  // Group the draft by assessment so each column saves in one PUT.
  const saveAll = useCallback(async () => {
    if (!gradebook || dirtyCount === 0) return;
    setSaveError(null);

    // Validate all dirty graded cells client-side before hitting the server.
    const byAssessment = new Map<string, GradeEntry[]>();
    for (const [key, value] of draft.entries()) {
      const [assessmentId, studentId] = key.split(':') as [string, string];
      const asmt = gradebook.assessments.find((a) => a.id === assessmentId);
      if (!asmt) continue;
      if (value.status === 'graded') {
        if (value.score == null || value.score < 0 || value.score > asmt.max_score) {
          setSaveError(`Fix scores outside 0–${asmt.max_score} before saving.`);
          return;
        }
      }
      const entry: GradeEntry = {
        student_id: studentId,
        status: value.status,
        score: value.status === 'graded' ? value.score : null,
      };
      const list = byAssessment.get(assessmentId) ?? [];
      list.push(entry);
      byAssessment.set(assessmentId, list);
    }

    try {
      for (const [assessmentId, entries] of byAssessment.entries()) {
        await saveMut.mutateAsync({ assessmentId, entries });
      }
      setDraft(new Map());
    } catch (err) {
      setSaveError(apiErrorMessage(err));
    }
  }, [gradebook, draft, dirtyCount, saveMut]);

  const handleRelease = useCallback(
    (assessment: GradebookAssessment, release: boolean) => {
      releaseMut.mutate({ assessmentId: assessment.id, release });
    },
    [releaseMut],
  );

  const isTeacher = user?.role === 'teacher';
  const subtitle = isTeacher
    ? 'Enter and release grades for the subjects you teach.'
    : 'View grades across the school. Grade entry is done by the subject teacher.';

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        pb: dirtyCount > 0 ? 10 : 3,
      }}
    >
      <PageHeader
        title="Gradebook"
        subtitle={subtitle}
        primaryAction={
          gradebook && canEdit ? (
            <ReleaseControl
              assessments={gradebook.assessments}
              disabled={releaseMut.isPending}
              onToggle={handleRelease}
            />
          ) : undefined
        }
      />

      <Box sx={{ mb: 3 }}>
        <ClassSubjectPicker
          options={options}
          value={selectedOption}
          onChange={(opt) => handleSelect(opt?.id ?? null)}
          loading={optionsQuery.isLoading}
        />
      </Box>

      {optionsQuery.isError && (
        <ErrorState message="We couldn't load your gradebooks." onRetry={() => void optionsQuery.refetch()} />
      )}

      {!optionsQuery.isLoading && !optionsQuery.isError && options.length === 0 && (
        <EmptyState
          variant="page"
          title="No gradebooks available"
          description={
            isTeacher
              ? 'You are not assigned to any subjects yet.'
              : 'No active class subjects were found.'
          }
        />
      )}

      {/* No selection yet (rare — we auto-select), prompt the user. */}
      {options.length > 0 && !selectedId && (
        <EmptyState
          variant="page"
          title="Choose a gradebook"
          description="Select a class and subject above to view or enter grades."
        />
      )}

      {selectedId && gradebookQuery.isLoading && <LoadingState variant="table" rows={8} label="Loading gradebook" />}

      {selectedId && gradebookQuery.isError && (
        <ErrorState
          title="Couldn't load this gradebook"
          message={apiErrorMessage(gradebookQuery.error)}
          onRetry={() => void gradebookQuery.refetch()}
        />
      )}

      {gradebook && (
        <>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ mb: 2, alignItems: { sm: 'center' } }}
          >
            <Typography variant="h4" component="h2">
              {gradebook.class_subject?.display_name}
            </Typography>
            {gradebook.semester && (
              <Chip size="small" variant="outlined" label={gradebook.semester.name} />
            )}
            {!canEdit && <StatusBadge label="Read-only" kind="neutral" />}
            {gradebook.drop_lowest_applied && (
              <Chip size="small" color="info" variant="outlined" label="Drop-lowest applied" />
            )}
          </Stack>

          {canEdit && (
            <Alert
              severity="info"
              icon={<InfoOutlinedIcon fontSize="inherit" />}
              sx={{ mb: 2 }}
            >
              Unreleased grades are visible to you only. Use "Release grades" to share a
              column with students.
            </Alert>
          )}

          {gradebook.assessments.length === 0 ? (
            <EmptyState
              variant="card"
              title="No assessments yet"
              description="Create assessments for this subject to start entering grades."
            />
          ) : gradebook.rows.length === 0 ? (
            <EmptyState
              variant="card"
              title="No students enrolled"
              description="This subject has no roster members yet."
            />
          ) : (
            <Grid container spacing={3} sx={{ flex: 1, minHeight: 0 }}>
              <Grid item xs={12} lg={8} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <GradebookGrid
                  gradebook={gradebook}
                  draft={draft}
                  canEdit={canEdit}
                  onCellChange={handleCellChange}
                />
              </Grid>
              <Grid item xs={12} lg={4}>
                <GradeDistributionCard gradebook={gradebook} />
              </Grid>
            </Grid>
          )}
        </>
      )}

      {/* Sticky save bar — appears only when there are unsaved edits (teacher only). */}
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

export default GradebookScreen;
