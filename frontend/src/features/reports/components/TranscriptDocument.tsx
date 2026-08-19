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
 * (⊙, not yet finalized).
 *
 * **D30 §D5 gave this document a real GPA at every level** — term, year and cumulative
 * — and it is the FIRST figure at each, because a GPA is what a tertiary transcript is
 * read for. The percentage means are kept beside it rather than replaced: they are a
 * different measure (0-100 vs 0-4) that the school already had.
 *
 * Each GPA is recomputed from the underlying credits, never averaged from the level
 * below, so a 6-credit summer block does not weigh the same as an 18-credit semester.
 * The credits behind each figure are printed next to it so the arithmetic is checkable
 * from the page.
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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {semester.gpa != null
              ? `GPA ${semester.gpa.toFixed(2)} · ${semester.total_credits} cr`
              : 'No credits yet'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {semester.term_average != null ? `avg ${semester.term_average.toFixed(1)}` : 'No grades yet'}
          </Typography>
        </Stack>
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
                  Course
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }} scope="col">
                  Credits
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
                  <TableCell>
                    {row.subject.code ? `${row.subject.code} — ` : ''}
                    {row.subject.name}
                  </TableCell>
                  <TableCell align="right">{row.credits ?? '—'}</TableCell>
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
  const { student, school, issued_at, years, cumulative_average, cumulative_gpa, total_credits } =
    data;

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
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {year.gpa != null
                      ? `GPA ${year.gpa.toFixed(2)} · ${year.total_credits} cr`
                      : ''}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {year.year_average != null ? `avg ${year.year_average.toFixed(1)}` : ''}
                  </Typography>
                </Stack>
              }
            >
              {year.semesters.map((sem) => (
                <SemesterBlock key={sem.semester.id} semester={sem} />
              ))}
            </CollapsibleSection>
          ))}

          <Divider />

          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'flex-end' }}>
            <Typography variant="subtitle1">Cumulative GPA</Typography>
            <Typography variant="h4" component="span">
              {cumulative_gpa != null ? cumulative_gpa.toFixed(2) : '—'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
            Credit-weighted over {total_credits} enrolled credits across all years. Ungraded
            courses count their credits and earn no quality points.
          </Typography>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'flex-end' }}>
            <Typography variant="body2" color="text.secondary">
              Cumulative average
            </Typography>
            <Typography variant="subtitle1" component="span">
              {cumulative_average != null ? cumulative_average.toFixed(1) : '—'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
            A plain mean of term averages — a percentage, not the GPA above.
          </Typography>
        </Stack>
      )}
    </PrintLayout>
  );
}

export default TranscriptDocument;
