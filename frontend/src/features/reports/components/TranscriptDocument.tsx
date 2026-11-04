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
import type { ReactNode } from 'react';
import { formatSchoolDateDayMonYear } from '@shared/utils/schoolDate';
import { genderLabel } from '@shared/types/enums';
import type { SchoolIdentity, Transcript, TranscriptSemester } from '../types';

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

/**
 * The letterhead, in the client's template (14 Oct 2026): logo, then the school name in
 * bold over its address / email / phone one per line, and "TRANSCRIPT OF GRADES" on the
 * right. `address` is printed with `pre-line`, so line breaks stored in the school
 * profile become separate lines, as on the template.
 */
function TranscriptLetterhead({ school }: { school: SchoolIdentity }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
    >
      <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
        {school.logo_url && (
          <Box
            component="img"
            src={school.logo_url}
            alt=""
            sx={{ height: 110, width: 110, objectFit: 'contain', flexShrink: 0 }}
          />
        )}
        <Box>
          <Typography component="h1" sx={{ fontWeight: 700, fontSize: '1rem' }}>
            {school.name}
          </Typography>
          {school.address && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
              {school.address}
            </Typography>
          )}
          {school.email && <Typography variant="body2">Email: {school.email}</Typography>}
          {school.phone && <Typography variant="body2">Tel: {school.phone}</Typography>}
        </Box>
      </Stack>
      <Typography
        component="h2"
        sx={{ fontSize: '1.6rem', fontWeight: 400, letterSpacing: 0.5, whiteSpace: 'nowrap' }}
      >
        TRANSCRIPT OF GRADES
      </Typography>
    </Stack>
  );
}

/** One `Label: value` line of the student block. */
function Field({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <Typography variant="body2">
      <Box component="span" sx={{ fontWeight: 700 }}>
        {label}:
      </Box>{' '}
      <Box component="span" sx={{ fontWeight: strong ? 700 : 400 }}>
        {value}
      </Box>
    </Typography>
  );
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
  // `issued_at` is no longer printed: the client's template has no issue line.
  const { student, school, years, cumulative_gpa, program_code, program_name } = data;
  const date = (value: string | null) => (value ? formatSchoolDateDayMonYear(value) : '');

  return (
    <PrintLayout
      schoolName={school.name}
      documentTitle="Academic Transcript"
      logoUrl={school.logo_url}
      header={<TranscriptLetterhead school={school} />}
    >
      {/* Student header — the client's template (14 Oct 2026), plus Student ID. Every
          value comes from SIMS; an empty one prints blank rather than a placeholder. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          columnGap: 4,
          rowGap: 1,
          mb: 3,
        }}
      >
        <Stack spacing={0.5}>
          <Field label="Student's Name" value={student.full_name} strong />
          <Field label="Student ID" value={student.student_number} strong />
          <Field label="Date of Birth" value={date(student.date_of_birth)} />
          <Field label="Gender" value={genderLabel(student.gender) ?? ''} />
          <Field label="Address" value={student.address ?? ''} />
        </Stack>
        <Stack spacing={0.5}>
          {/* D39 (Meeting #2 item 7) — the programme; the template prints its NAME. */}
          <Field label="Programme" value={program_name ?? program_code ?? ''} />
          <Field label="Date of Entry" value={date(student.date_of_entry)} />
          <Field label="Date of Completion" value={date(student.date_of_completion)} />
          <Field label="Date of Graduation" value={date(student.date_of_graduation)} />
        </Stack>
      </Box>

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

          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'baseline', justifyContent: 'flex-end' }}
          >
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
