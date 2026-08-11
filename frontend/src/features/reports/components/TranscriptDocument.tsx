import {
  Box,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { PrintLayout, CollapsibleSection, EmptyState } from '@shared/components';
import { GradeLetter } from './GradeLetter';
import type { Transcript, TranscriptSemester } from '../types';

/**
 * TranscriptDocument — the printable multi-year transcript (design-system §7.10).
 * Year → semester → subject hierarchy inside `PrintLayout`; each academic year is a
 * `CollapsibleSection` (most recent expanded). The active semester is marked "current"
 * (⊙, not yet finalized). A cumulative mean (NOT a GPA) is shown at the foot.
 */
export interface TranscriptDocumentProps {
  data: Transcript;
}

function formatIssued(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function SemesterBlock({ semester }: { semester: TranscriptSemester }) {
  return (
    <Box component="section" sx={{ mb: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}
      >
        <Typography variant="subtitle1" component="h4">
          {semester.semester.name}
          {semester.is_current && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              ⊙ current · not yet finalized
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {semester.term_average != null ? `Term avg ${semester.term_average.toFixed(1)}` : 'No grades yet'}
        </Typography>
      </Stack>

      {semester.subjects.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No recorded grades for this term.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={`${semester.semester.name} subjects`}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }} scope="col">
                  Subject
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }} scope="col">
                  Score
                </TableCell>
                <TableCell align="center" sx={{ fontWeight: 600 }} scope="col">
                  Letter
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }} scope="col">
                  Teacher
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {semester.subjects.map((row) => (
                <TableRow key={row.subject.id}>
                  <TableCell>{row.subject.name}</TableCell>
                  <TableCell align="right">
                    {row.numeric != null ? row.numeric.toFixed(1) : '—'}
                  </TableCell>
                  <TableCell align="center">
                    <GradeLetter letter={row.letter} />
                  </TableCell>
                  <TableCell>{row.teacher ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export function TranscriptDocument({ data }: TranscriptDocumentProps) {
  const { student, school, issued_at, years, cumulative_average } = data;

  return (
    <PrintLayout
      schoolName={school.name}
      documentTitle="Academic Transcript"
      logoUrl={school.logo_url}
      meta={
        <>
          <div>Student No. {student.student_number}</div>
          <div>Issued {formatIssued(issued_at)}</div>
        </>
      }
    >
      {/* Student header */}
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h4" component="h2">
          {student.full_name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          DOB {student.date_of_birth} · Status: {student.status}
          {student.year_group ? ` · ${student.year_group}` : ''}
        </Typography>
      </Stack>

      {years.length === 0 ? (
        <EmptyState
          title="No academic records yet for this student"
          description="A transcript appears once the student has grades in at least one term."
          variant="card"
        />
      ) : (
        <Stack spacing={2}>
          {years.map((year, index) => (
            <CollapsibleSection
              key={year.academic_year.id}
              defaultExpanded={index === 0}
              title={year.academic_year.name}
              summary={
                <Typography variant="body2" color="text.secondary">
                  {year.year_average != null ? `Year avg ${year.year_average.toFixed(1)}` : ''}
                </Typography>
              }
            >
              {year.semesters.map((sem) => (
                <SemesterBlock key={sem.semester.id} semester={sem} />
              ))}
            </CollapsibleSection>
          ))}

          <Divider />

          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'flex-end' }}>
            <Typography variant="subtitle1">Cumulative average</Typography>
            <Typography variant="h4" component="span">
              {cumulative_average != null ? cumulative_average.toFixed(1) : '—'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
            A plain mean of term averages across all years — not a GPA.
          </Typography>
        </Stack>
      )}
    </PrintLayout>
  );
}

export default TranscriptDocument;
