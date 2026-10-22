import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Divider } from '@mui/material';
import { PageHeader, LoadingState, ErrorState } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useAssessmentPolicy, useUpdateAssessmentPolicy } from '../hooks/useSettings';
import { apiErrorMessage } from '@shared/api/errorMessages';

/**
 * Assessment policy (api-spec §11, DB14). The school-level defaults for absent-as-zero,
 * make-up allowance, and drop-lowest count. Principal edits; others view. Those three
 * fields are the COALESCE base that category/assessment overrides refine (backend).
 *
 * **D32 added a fourth control that is not a grading rule** (brief §4): whether students
 * can see their grades at all. It shares this screen because it shares the singleton row
 * behind it — a separate settings tab for one switch would need its own endpoint and its
 * own screen — but it is separated below a divider, because "how a grade is calculated"
 * and "who may look at it" are different decisions and should not read as one list.
 */
export function AssessmentPolicyScreen() {
  const { user } = useAuth();
  const canEdit = user ? user.role === 'principal' : false;

  const query = useAssessmentPolicy();
  const updateMut = useUpdateAssessmentPolicy();

  const [absentAsZero, setAbsentAsZero] = useState(false);
  const [allowMakeup, setAllowMakeup] = useState(false);
  const [dropLowest, setDropLowest] = useState(0);
  const [studentsCanView, setStudentsCanView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) {
      setAbsentAsZero(query.data.absent_as_zero);
      setAllowMakeup(query.data.allow_makeup);
      setDropLowest(query.data.drop_lowest_count);
      setStudentsCanView(query.data.students_can_view_grades ?? false);
    }
  }, [query.data]);

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const handleSave = () => {
    setError(null);
    updateMut.mutate(
      {
        data: {
          absent_as_zero: absentAsZero,
          allow_makeup: allowMakeup,
          drop_lowest_count: Math.max(0, Math.trunc(dropLowest)),
          students_can_view_grades: studentsCanView,
        },
      },
      {
        onSuccess: () => setSaved(true),
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Assessment policy"
        subtitle="School-wide defaults for how grades are calculated."
      />

      <Paper variant="outlined" sx={{ p: 3, maxWidth: 560 }}>
        {error && (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={3}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={absentAsZero}
                  onChange={(e) => setAbsentAsZero(e.target.checked)}
                  disabled={!canEdit}
                />
              }
              label="Count absences as zero"
            />
            <Typography variant="body2" color="text.secondary">
              When on, an absent assessment counts as 0 in the average. When off, it is excluded.
            </Typography>
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={allowMakeup}
                  onChange={(e) => setAllowMakeup(e.target.checked)}
                  disabled={!canEdit}
                />
              }
              label="Allow make-up scores"
            />
            <Typography variant="body2" color="text.secondary">
              When on, teachers may record a make-up score for a missed assessment.
            </Typography>
          </Box>

          <Box>
            <TextField
              label="Drop lowest count"
              type="number"
              value={dropLowest}
              onChange={(e) => setDropLowest(Number(e.target.value))}
              disabled={!canEdit}
              inputProps={{ min: 0 }}
              sx={{ width: 180 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Number of lowest grades to drop from each category's average by default.
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Student visibility
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={studentsCanView}
                  onChange={(e) => setStudentsCanView(e.target.checked)}
                  disabled={!canEdit}
                />
              }
              label="Students can see their grades"
            />
            <Typography variant="body2" color="text.secondary">
              When off, students cannot open My Grades or their report card, and the
              navigation item is hidden. Lecturers and the Dean are unaffected.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Students never see grade revisions either way — whether a revision was
              approved or denied, they only see the resulting mark.
            </Typography>
          </Box>

          {canEdit && (
            <Box>
              <Button variant="contained" onClick={handleSave} disabled={updateMut.isPending}>
                {updateMut.isPending ? 'Saving…' : 'Save policy'}
              </Button>
            </Box>
          )}
        </Stack>
      </Paper>

      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message="Assessment policy saved"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}

export default AssessmentPolicyScreen;
