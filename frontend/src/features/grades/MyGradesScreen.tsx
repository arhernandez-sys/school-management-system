import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Divider,
  Grid,
  Stack,
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
import { useSelectedYear } from '@app/providers/YearContext';
import { useMyGrades } from './hooks/useGrades';
import type { MyGradeSubject } from './types';
import { formatNumeric, letterKind } from './components/gradeDisplay';
import { SubjectGradesTable } from './components/SubjectGradesTable';

/**
 * "My Grades" (§7.7, student scope) — the student's own released grades. Read-only; the
 * server applies the release filter, so unreleased assessments are never in the payload.
 *
 * Two views over the SAME cached query, selected by the `?subject=<class_subject_id>`
 * search param (same URL-selection convention as GradebookScreen's `?class_subject_id`):
 *  - Grid view (no param): one clickable card per subject with its term average.
 *  - Detail view (param matches a subject): that subject's assessment breakdown only.
 * Deep-linkable and reload-safe; a stale/invalid param falls back to the grid.
 */
function subjectKey(subject: MyGradeSubject): string {
  return subject.class_subject?.id ?? subject.class_subject?.subject?.id ?? 'unknown';
}

export function MyGradesScreen() {
  const { selectedYearId } = useSelectedYear();
  const query = useMyGrades(selectedYearId);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('subject');

  const subjects = useMemo(() => query.data?.by_subject ?? [], [query.data]);

  const selectedSubject = useMemo(
    () => (selectedId ? subjects.find((s) => s.class_subject?.id === selectedId) ?? null : null),
    [subjects, selectedId],
  );

  // A stale/invalid ?subject= (e.g. a deep link to a subject no longer released) —
  // drop it so the view falls back to the grid instead of showing a blank detail.
  useEffect(() => {
    if (query.data && selectedId && !selectedSubject) {
      setSearchParams({}, { replace: true });
    }
  }, [query.data, selectedId, selectedSubject, setSearchParams]);

  const openSubject = (id: string) => setSearchParams({ subject: id });
  const backToGrid = () => setSearchParams({});

  return (
    <Box>
      <PageHeader
        title="My Grades"
        subtitle="Your released grades for the current term, by subject."
      />

      {query.isLoading && <LoadingState variant="cards" rows={3} label="Loading your grades" />}

      {query.isError && (
        <ErrorState message={apiErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      )}

      {query.data && subjects.length === 0 && (
        <EmptyState
          variant="page"
          title="No grades yet"
          description="Once your teachers release grades, they'll appear here."
        />
      )}

      {query.data && subjects.length > 0 && selectedSubject ? (
        <SubjectDetail subject={selectedSubject} onBack={backToGrid} />
      ) : (
        query.data &&
        subjects.length > 0 && <SubjectGrid subjects={subjects} onOpen={openSubject} />
      )}
    </Box>
  );
}

interface SubjectGridProps {
  subjects: MyGradeSubject[];
  onOpen: (id: string) => void;
}

/** Responsive grid of clickable subject summary cards (one per subject). */
function SubjectGrid({ subjects, onOpen }: SubjectGridProps) {
  return (
    <Grid container spacing={2}>
      {subjects.map((subject) => {
        const id = subject.class_subject?.id ?? null;
        const name = subject.class_subject?.subject?.name ?? 'Subject';
        const count = subject.assessments.length;
        const caption = count > 0 ? `${count} ${count === 1 ? 'assessment' : 'assessments'}` : 'No released grades yet';

        const body = (
          <CardContent sx={{ height: '100%' }}>
            <Stack spacing={1} sx={{ height: '100%' }}>
              <Box>
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                  {name}
                </Typography>
                {subject.teacher && (
                  <Typography variant="body2" color="text.secondary">
                    {subject.teacher.full_name}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h4" component="p">
                  {formatNumeric(subject.term_numeric)}
                </Typography>
                {subject.term_letter && (
                  <StatusBadge label={subject.term_letter} kind={letterKind(subject.term_letter)} />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {caption}
              </Typography>
            </Stack>
          </CardContent>
        );

        return (
          <Grid item xs={12} sm={6} md={4} key={subjectKey(subject)}>
            <Card sx={{ height: '100%' }}>
              {id ? (
                <CardActionArea
                  onClick={() => onOpen(id)}
                  sx={{ height: '100%' }}
                  aria-label={`View ${name} grades`}
                >
                  {body}
                </CardActionArea>
              ) : (
                body
              )}
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}

interface SubjectDetailProps {
  subject: MyGradeSubject;
  onBack: () => void;
}

/** Single-subject drill-down: back affordance, header block, and the grades table. */
function SubjectDetail({ subject, onBack }: SubjectDetailProps) {
  const name = subject.class_subject?.subject?.name ?? 'Subject';

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 2 }}>
        All subjects
      </Button>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1.5 }}
      >
        <Box>
          <Typography variant="h4" component="h2">
            {name}
          </Typography>
          {subject.teacher && (
            // Students do not have access to teacher profiles — show the name as plain
            // text (the Teachers module is hidden from students).
            <Typography variant="body2" color="text.secondary">
              {subject.teacher.full_name}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h4" component="p">
            {formatNumeric(subject.term_numeric)}
          </Typography>
          {subject.term_letter && (
            <StatusBadge label={subject.term_letter} kind={letterKind(subject.term_letter)} />
          )}
        </Stack>
      </Stack>

      <Divider sx={{ mb: 1 }} />

      <SubjectGradesTable subject={subject} />
    </Box>
  );
}

export default MyGradesScreen;
