import { useEffect, useState } from 'react';
import { Box, Stack } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { StudentPicker } from '../components/StudentPicker';
import { TranscriptDocument } from '../components/TranscriptDocument';
import { useReportStudents, useTranscript } from '../hooks/useReports';
import type { StudentRef } from '../types';

/**
 * Transcript screen (design-system §7.10) — the multi-year academic record.
 *
 * ROLE GATE (D26): visible to PRINCIPAL + SECRETARY ONLY. Teachers/students never
 * reach this screen (route + nav gated), and the handler also 403s them — this is the
 * one report restricted to P/S. The picker lets P/S choose any student. A `student_id`
 * query param (deep link from the report card's "View full transcript") pre-selects.
 */
export function TranscriptScreen() {
  const { user } = useAuth();
  const allowed = user?.role === 'principal' || user?.role === 'secretary';

  const [searchParams] = useSearchParams();
  const linkedStudentId = searchParams.get('student_id');
  const [student, setStudent] = useState<StudentRef | null>(null);

  // Resolve a deep-linked student_id (from the report card) into a full StudentRef.
  const linkedLookup = useReportStudents({ page_size: 100 });
  useEffect(() => {
    if (linkedStudentId && !student && linkedLookup.data) {
      const match = linkedLookup.data.items.find((s) => s.id === linkedStudentId);
      if (match) setStudent(match);
    }
  }, [linkedStudentId, student, linkedLookup.data]);

  const query = useTranscript(allowed ? student?.id ?? null : null);

  if (!allowed) {
    // UI guard mirrors the server (D26). The route is also role-gated upstream.
    return (
      <Box>
        <PageHeader title="Transcript" />
        <EmptyState
          title="Transcripts are restricted"
          description="Only principals and secretaries can view student transcripts."
          variant="page"
        />
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Transcript"
        subtitle="A student's full multi-year academic record across all terms."
      />

      <Stack className="sis-print-hide" sx={{ mb: 3 }}>
        <StudentPicker value={student} onChange={setStudent} />
      </Stack>

      {!student ? (
        <EmptyState
          title="Choose a student"
          description="Search for a student above to assemble their transcript."
          variant="page"
        />
      ) : query.isLoading ? (
        <LoadingState variant="table" rows={6} label="Loading transcript" />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <TranscriptDocument data={query.data} />
      ) : null}
    </Box>
  );
}

export default TranscriptScreen;
