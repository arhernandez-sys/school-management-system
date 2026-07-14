import { useEffect, useState } from 'react';
import { Box, Button, Stack } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { StudentPicker } from '../components/StudentPicker';
import { TermPicker } from '../components/TermPicker';
import { ReportCardDocument } from '../components/ReportCardDocument';
import { useActiveTerm, useMyReportCard, useReportCard } from '../hooks/useReports';
import type { StudentRef } from '../types';

/**
 * Report card screen (design-system §7.8). Role-aware:
 *  - Student: their own card via /me — no picker.
 *  - Principal / Secretary / Teacher: pick a student (+ term) → render the card.
 * P/S also get a "View full transcript" link (teachers/students do not — D26).
 */
export function ReportCardScreen() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const canViewTranscript = user?.role === 'principal' || user?.role === 'secretary';

  const activeTerm = useActiveTerm();
  const [semesterId, setSemesterId] = useState('');
  const [student, setStudent] = useState<StudentRef | null>(null);

  // Default the term to the active semester once it loads.
  useEffect(() => {
    if (!semesterId && activeTerm.data?.semester?.id) {
      setSemesterId(activeTerm.data.semester.id);
    }
  }, [activeTerm.data, semesterId]);

  const myCard = useMyReportCard(isStudent ? semesterId || undefined : undefined);
  const pickedCard = useReportCard(isStudent ? null : student?.id ?? null, semesterId || undefined);

  const query = isStudent ? myCard : pickedCard;
  // For a student the /me query runs immediately; for others it runs once a student is picked.
  const showDocument = isStudent || Boolean(student);

  return (
    <Box>
      <PageHeader
        title="Report card"
        subtitle="A per-term summary of a student's subject grades and attendance."
      />

      {/* Controls (hidden from print) */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        className="sis-print-hide"
        sx={{ mb: 3, alignItems: { sm: 'center' } }}
      >
        {!isStudent && <StudentPicker value={student} onChange={setStudent} />}
        <TermPicker value={semesterId} onChange={setSemesterId} />
        {canViewTranscript && student && (
          <Button
            component={RouterLink}
            to={`${ROUTES.reports}/transcript?student_id=${student.id}`}
            startIcon={<DescriptionOutlinedIcon />}
            variant="outlined"
          >
            View full transcript
          </Button>
        )}
      </Stack>

      {!showDocument ? (
        <EmptyState
          title="Choose a student"
          description="Search for a student above to generate their report card."
          variant="page"
        />
      ) : query.isLoading ? (
        <LoadingState variant="form" rows={6} label="Loading report card" />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <ReportCardDocument data={query.data} />
      ) : null}
    </Box>
  );
}

export default ReportCardScreen;
