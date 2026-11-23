import { useMemo } from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useProgressionPreview, type ProgressionStudent } from '../hooks/useSettings';

/**
 * What archiving a year will do to each student's year of study (`students.progression`).
 *
 * Shown inside the archive confirmation, because the archive is what applies it: a student
 * who passed every course in the year's Summer and Semester terms moves First → Second, or
 * Second → Completed. Everyone else repeats. The list shows WHY each student is not
 * moving, so a missing grade can be fixed before the year is frozen rather than after.
 */
export function ProgressionPreview({ yearId }: { yearId: string }) {
  const query = useProgressionPreview(yearId);
  const data = query.data;

  const notMoving = useMemo<ProgressionStudent[]>(
    () => (data?.students ?? []).filter((s) => s.outcome === 'repeat' || s.outcome === 'skip'),
    [data],
  );

  if (query.isLoading) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 2 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">Checking each student's results…</Typography>
      </Stack>
    );
  }
  if (query.isError) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Could not check progression: {apiErrorMessage(query.error)}
      </Alert>
    );
  }
  if (!data) return null;

  if (data.terms.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        This year has no Summer or Semester sessions, so no student will change year.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Year-end progression
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Students who passed every course in {data.terms.join(', ')} move up a year.
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
        <Chip size="small" color="success" label={`${data.promoted} to Second year`} />
        <Chip size="small" color="primary" label={`${data.completed} completed`} />
        <Chip size="small" color="warning" label={`${data.repeating} repeating`} />
        {data.skipped > 0 && <Chip size="small" label={`${data.skipped} not checked`} />}
      </Stack>

      {data.repeating > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          To grant an exception, cancel and open “Year-end progression” on the year first.
        </Typography>
      )}
      {notMoving.length > 0 && (
        <Box
          component="ul"
          sx={{
            m: 0,
            pl: 2,
            maxHeight: 220,
            overflowY: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            py: 1,
            pr: 1,
          }}
        >
          {notMoving.map((s) => (
            <Typography key={s.student_id} component="li" variant="body2" sx={{ mb: 0.5 }}>
              <strong>{s.full_name}</strong> ({s.student_number})
              {s.year_of_study ? ` · ${s.year_of_study} year` : ''} —{' '}
              {s.outcome === 'repeat' ? 'repeats' : 'not checked'}
              {s.reasons.length > 0 && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {' '}
                  {s.reasons.join(' ')}
                </Typography>
              )}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default ProgressionPreview;
