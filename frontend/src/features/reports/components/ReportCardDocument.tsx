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
import { PrintLayout, EmptyState } from '@shared/components';
import { GradeLetter } from './GradeLetter';
import type { ReportCard } from '../types';

/**
 * ReportCardDocument — the printable report card, laid out to match
 * `BAJC MID SEMESTER REPORT TEMPLATE.pdf` (D30 §D13).
 *
 * **Rebuilt in Phase 3 from the sixth-form layout it started as.** The old table was
 * `Subject | Score | Letter | Teacher` with a term-average footer; BAJC's document is
 * `Course Code | Course Name | Credits | Instructor | Grade` over a labelled header
 * block, closing on a GPA row and the Dean's signature block.
 *
 * Three things about it are deliberate:
 *
 * * **The grade column is the LETTER ONLY**, blank when ungraded. The sample prints no
 *   percentages, and the numeric is still available to staff through the gradebook.
 * * **Ungraded courses are still listed**, with a blank grade. They are what makes the
 *   GPA denominator right (decision #4 — all enrolled credits), so hiding them would
 *   leave a printed figure nobody could check by adding up the rows.
 * * **`term_average` is still rendered alongside the GPA.** It is a 0-100 percentage
 *   and the GPA is a 0-4 figure; they answer different questions and dropping the
 *   average would lose information the school already had.
 *
 * `variant` switches only the heading. The filename of the source PDF says
 * "mid semester" while the document inside is titled "End of Semester Report"; only
 * one layout was ever supplied, and whether the two really differ is open with BAJC
 * (plan §G item 4). So there is ONE template with a heading variant, rather than two
 * templates guessing at a difference.
 */
export interface ReportCardDocumentProps {
  data: ReportCard;
  variant?: 'mid-semester' | 'end-of-semester';
}

/** The label block under the letterhead: Student ID · Name · Program · Semester · Period · Block. */
function LabelBlock({ data }: { data: ReportCard }) {
  const rows: Array<[string, string]> = [
    ['Student ID', data.student.student_number],
    ['Student Name', data.student.full_name],
    ['Program', data.program_code ?? '—'],
    // The sample leaves `Semester` blank and carries the term in `Period`. Both are
    // printed: the semester name is genuinely useful and costs nothing.
    ['Semester', data.semester.name],
    ['Period', data.period ?? '—'],
    ['Block', data.block ?? '-'],
  ];
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'max-content 1fr', sm: 'max-content 1fr max-content 1fr' },
        columnGap: 2,
        rowGap: 0.75,
        m: 0,
        mb: 3,
      }}
    >
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 500 }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function ReportCardDocument({ data, variant = 'end-of-semester' }: ReportCardDocumentProps) {
  const {
    student,
    school,
    semester,
    subjects,
    attendance_summary,
    term_average,
    term_average_letter,
    gpa,
    total_credits,
  } = data;

  const heading = variant === 'mid-semester' ? 'Mid-Semester Report' : 'End of Semester Report';
  const documentTitle = `${heading} — ${semester.name}, ${semester.academic_year_name}`;

  return (
    <PrintLayout
      schoolName={school.name}
      documentTitle={documentTitle}
      logoUrl={school.logo_url}
      meta={
        <>
          <div>Student No. {student.student_number}</div>
          {/* D29: the letterhead names the student's LEVEL. A sixth-former sits many
              subject classes, so there is no single class name to print here. */}
          {student.year_of_study && <div>{student.year_of_study}</div>}
        </>
      }
    >
      <Typography variant="h4" component="h2" sx={{ textAlign: 'center', mb: 3 }}>
        {heading}
      </Typography>

      <LabelBlock data={data} />

      {subjects.length === 0 ? (
        <EmptyState
          title="No courses to report"
          description="This student is not enrolled in any courses for the selected term."
          variant="card"
        />
      ) : (
        <>
          {/* `overflow-x: auto` so five columns never make the page itself scroll. */}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Course grades">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }} scope="col">
                    Course Code
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }} scope="col">
                    Course Name
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }} scope="col">
                    Credits
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }} scope="col">
                    Instructor
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }} scope="col">
                    Grade
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {subjects.map((row) => (
                  <TableRow key={row.subject.id}>
                    <TableCell>{row.subject.code || '—'}</TableCell>
                    <TableCell>{row.subject.name}</TableCell>
                    <TableCell align="right">{row.credits ?? '—'}</TableCell>
                    <TableCell>{row.teacher ?? '—'}</TableCell>
                    <TableCell align="center">
                      {/* Blank when ungraded or withheld — the sample prints nothing
                          rather than a placeholder, and the row is still here so the
                          credits are visibly part of the GPA denominator. */}
                      {row.status === 'pending' || !row.letter ? (
                        <Typography variant="body2" color="text.secondary" component="span">
                          —
                        </Typography>
                      ) : (
                        <GradeLetter letter={row.letter} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}

                {/* Spacer row, then the GPA row — the sample's shape exactly. */}
                <TableRow>
                  <TableCell colSpan={5} sx={{ border: 0, height: 16, p: 0 }} />
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
                    GPA
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {total_credits || '—'}
                  </TableCell>
                  <TableCell />
                  <TableCell align="center" sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    {gpa != null ? gpa.toFixed(2) : '—'}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          <Divider sx={{ my: 2 }} />

          {/* Summary line */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 4 }}
            sx={{ justifyContent: 'space-between' }}
          >
            <Box>
              <Typography variant="subtitle2">Attendance</Typography>
              <Typography variant="body2" color="text.secondary">
                {attendance_summary.pct_present}% present · {attendance_summary.absent} absences ·{' '}
                {attendance_summary.late} late
              </Typography>
            </Box>
            <Box sx={{ textAlign: { sm: 'right' } }}>
              <Typography variant="subtitle2">Term average</Typography>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: { sm: 'flex-end' } }}
              >
                <Typography variant="h5" component="span">
                  {term_average != null ? term_average.toFixed(1) : '—'}
                </Typography>
                {term_average_letter && <GradeLetter letter={term_average_letter} />}
              </Stack>
            </Box>
          </Stack>
        </>
      )}

      {/* Dean signature + contact footer (§D13). Two notes:

          The signature IMAGE from the sample is NOT reproduced — there is no asset for
          it in the repo, and generating one would be forging a signature onto an
          official document. The signature LINE is printed so the Dean signs the sheet.

          The addresses are literals from the source document. They are not in
          `school_profile`, which carries the school's own `contact_email` rather than
          the Dean's, so there is nothing to read them from yet; when that table gains
          office contacts these two lines should come from it. */}
      <Divider sx={{ mt: 4, mb: 2 }} />
      <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ width: 220, borderBottom: '1px solid', borderColor: 'text.primary', mb: 0.5 }} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Dean
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Email: dean@bajc.edu.bz
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Website: http://www.bajc.edu.bz
        </Typography>
      </Stack>
    </PrintLayout>
  );
}

export default ReportCardDocument;
