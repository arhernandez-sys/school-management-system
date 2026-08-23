import { useEffect, useState } from 'react';
import { Box, Button, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader, LoadingState, EmptyState } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { StudentPicker } from '../components/StudentPicker';
import { TermPicker } from '../components/TermPicker';
import { ReportCardDocument } from '../components/ReportCardDocument';
import { useActiveTerm, useMyReportCard, useReportCard } from '../hooks/useReports';
import type { ReportCardKind, StudentRef } from '../types';

/**
 * Report card screen (design-system §7.8). Role-aware:
 *  - Student: their own card via /me — no picker.
 *  - Principal / Secretary / Teacher: pick a student (+ term) → render the card.
 * P/S also get a "View full transcript" link (teachers/students do not — D26).
 *
 * **D32 adds the Mid-Term / End-Term switch (brief §5).** The two are not two views of
 * one document: a mid-term card is read back frozen from `report_card_snapshots` and
 * never recalculates, while an end-term card computes from current grades. That is why
 * the switch is a first-class control rather than a print option, and why the failure
 * modes below are explained rather than shown as a generic error — "the mid-term period
 * has not closed yet" is a state the user can act on.
 */
export function ReportCardScreen() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const canViewTranscript = user?.role === 'principal' || user?.role === 'secretary';

  const activeTerm = useActiveTerm();
  const [semesterId, setSemesterId] = useState('');
  const [student, setStudent] = useState<StudentRef | null>(null);
  // End-term is the default because it is the everyday document; the mid-term card only
  // exists for terms the Dean has configured a mid-term period on.
  const [kind, setKind] = useState<ReportCardKind>('endterm');

  // Default the term to the active semester once it loads.
  useEffect(() => {
    if (!semesterId && activeTerm.data?.semester?.id) {
      setSemesterId(activeTerm.data.semester.id);
    }
  }, [activeTerm.data, semesterId]);

  const myCard = useMyReportCard(isStudent ? semesterId || undefined : undefined, kind);
  const pickedCard = useReportCard(
    isStudent ? null : (student?.id ?? null),
    semesterId || undefined,
    kind,
  );

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
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kind}
          onChange={(_e, next: ReportCardKind | null) => next && setKind(next)}
          aria-label="Report type"
        >
          <ToggleButton value="midterm">Mid-Term</ToggleButton>
          <ToggleButton value="endterm">End-Term</ToggleButton>
        </ToggleButtonGroup>
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
        /* A mid-term card has three states that are NOT failures — the window is still
           open, the term has no mid-term period, or the student was not enrolled in it.
           The server names each one, so the message is shown rather than swallowed by a
           generic "something went wrong" the user cannot act on. */
        <EmptyState
          title="This report is not available yet"
          description={apiErrorMessage(query.error)}
          variant="page"
          action={{ label: 'Try again', onClick: () => void query.refetch() }}
        />
      ) : query.data ? (
        <ReportCardDocument data={query.data} />
      ) : null}
    </Box>
  );
}

export default ReportCardScreen;
