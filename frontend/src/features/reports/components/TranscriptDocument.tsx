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
import { formatSchoolDate } from '@shared/utils/schoolDate';
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
        {/* D39 (Meeting #2): the per-semester `GPA x · n cr  avg y` line used to sit
            here. With one semester on record it printed the identical figures as the
            year header directly above it — the same numbers twice, four lines apart,
            which reads like a discrepancy the reader has to rule out. The year header
            keeps its summary; the semester keeps its name and its current-term caption.
            `semester.gpa` / `term_average` are still in the payload for the screens that
            do want a per-term breakdown. */}
      </Stack>

      {semester.subjects.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No recorded grades for this session.
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
                {/* D39 (Meeting #2): `Letter` and `Teacher` columns removed. The letter
                    is a restatement of the score against the grading scale printed
                    elsewhere, and WHO taught a course is an internal staffing fact — a
                    transcript is a record of what the student achieved, and naming a
                    lecturer on a permanent external document exposes staff data no
                    receiving institution asked for. */}
              </TableRow>
            </TableHead>
            <TableBody>
              {semester.subjects.map((row) => (
                <TableRow key={row.subject.id}>
                  <TableCell>
                    {row.subject.code ? `${row.subject.code} — ` : ''}
                    {row.subject.name}
                    {/* D35 — a course with no grade because it was AUDITED or WITHDRAWN
                        carries its registry notation (AU / W/P / W/F). That notation is
                        the whole reason the client wants the status recorded: a permanent
                        record that silently omits the course a student withdrew from is
                        not a transcript.

                        D39 removed the Letter column it used to live in, so it moves onto
                        the course name rather than disappearing with the column. Dropping
                        it would have turned an audited course into one that merely looks
                        ungraded — the exact failure D35 was written to prevent. */}
                    {row.notation && (
                      <Typography component="span" variant="body2" sx={{ fontWeight: 600, ml: 1 }}>
                        ({row.notation})
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{row.credits ?? '—'}</TableCell>
                  <TableCell align="right">
                    {row.numeric != null ? row.numeric.toFixed(1) : '—'}
                  </TableCell>
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
  // D39 removed the cumulative-average block and the per-row Letter column, so
  // `cumulative_average` and `total_credits` are no longer read here. Both remain on the
  // `Transcript` type and in the API payload — this document simply stopped printing them.
  const { student, school, issued_at, years, cumulative_gpa, program_code, program_name } = data;

  return (
    <PrintLayout
      schoolName={school.name}
      documentTitle="Academic Transcript"
      logoUrl={school.logo_url}
      // D39 — the letterhead, so the issuing institution is contactable from the paper.
      contactLines={[school.address, school.phone, school.email]}
      meta={
        <>
          <div>Student No. {student.student_number}</div>
          <div>Issued {formatSchoolDate(issued_at)}</div>
        </>
      }
    >
      {/* Student header */}
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h4" component="h2">
          {student.full_name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          DOB {formatSchoolDate(student.date_of_birth)} · Status: {student.status}
          {student.year_of_study ? ` · ${student.year_of_study}` : ''}
        </Typography>
        {/* D39 (Meeting #2 item 7) — the programme. Without it the course list is
            uninterpretable to a receiving institution: the same BIOL1102 sits in a
            teaching degree and a science one. Code and name together, and the whole line
            is omitted rather than printing "—" when the student has no registration. */}
        {(program_code || program_name) && (
          <Typography variant="body2" color="text.secondary">
            Programme: {[program_code, program_name].filter(Boolean).join(' — ')}
          </Typography>
        )}
      </Stack>

      {years.length === 0 ? (
        <EmptyState
          title="No academic records yet for this student"
          description="A transcript appears once the student has grades in at least one session."
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
          {/* D39 (Meeting #2): everything that used to follow `Cumulative GPA` is gone —
              the credit-weighting explainer, the `Cumulative average` figure, and the
              note distinguishing it from the GPA. Those three were written for staff
              reading the number on screen and checking the arithmetic; on a transcript
              issued to a third party they read as the institution hedging its own
              headline figure. `cumulative_average` and `total_credits` stay in the API
              payload (`reports/schemas.py`) — this is a display change only, and the
              staff-facing screens still have both. */}
        </Stack>
      )}
    </PrintLayout>
  );
}

export default TranscriptDocument;
