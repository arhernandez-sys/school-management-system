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
 *
 * **D32 makes the variant follow the DATA by default.** `data.report_kind` says which
 * report the server produced, so the heading is derived from it rather than from a prop a
 * caller might forget — a mid-term card headed "End of Semester Report" would be a
 * mislabelled official document. The prop remains as an explicit override.
 */
export interface ReportCardDocumentProps {
  data: ReportCard;
  variant?: 'mid-semester' | 'end-of-semester';
}

/**
 * A freeze instant in the reader's own timezone, to the day.
 *
 * To the DAY, not the minute: "the marks as they stood on 12 October" is what a reader
 * needs from a report card, and a timestamp would imply a precision the grading process
 * does not have.
 */
function formatFrozenAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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

export function ReportCardDocument({ data, variant }: ReportCardDocumentProps) {
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
    report_kind,
    frozen_at,
  } = data;

  // D32: the data decides unless a caller overrides it.
  const resolvedVariant =
    variant ?? (report_kind === 'midterm' ? 'mid-semester' : 'end-of-semester');
  const heading =
    resolvedVariant === 'mid-semester' ? 'Mid-Session Report' : 'End-Session Report';
  const documentTitle = `${heading} — ${semester.name}, ${semester.academic_year_name}`;

  return (
    <PrintLayout
      schoolName={school.name}
      documentTitle={documentTitle}
      logoUrl={school.logo_url}
      // D39 — the letterhead. `ReportSchool` has carried address/phone/email all along
      // and the document printed none of them.
      contactLines={[school.address, school.phone, school.email]}
      meta={
        <>
          <div>Student No. {student.student_number}</div>
          {/* D29: the letterhead names the student's LEVEL. A sixth-former sits many
              subject classes, so there is no single class name to print here. */}
          {student.year_of_study && <div>{student.year_of_study}</div>}
        </>
      }
    >
      <Typography variant="h4" component="h2" sx={{ textAlign: 'center', mb: 1 }}>
        {heading}
      </Typography>

      {/* D32 — a mid-term card is a FROZEN document, and saying when it was captured is
          what makes it defensible: "this is what the marks were on that date", rather
          than an undated figure a reader would assume is current. Printed, not hidden
          behind `sis-print-hide`, because the paper copy needs it most. */}
      {frozen_at && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ textAlign: 'center', mb: 3 }}
        >
          Grades as recorded on {formatFrozenAt(frozen_at)}
        </Typography>
      )}
      {!frozen_at && <Box sx={{ mb: 2 }} />}

      <LabelBlock data={data} />

      {subjects.length === 0 ? (
        <EmptyState
          title="No courses to report"
          description="This student is not enrolled in any courses for the selected session."
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
                          credits are visibly part of the GPA denominator.

                          D39 (Meeting #2): the letter is PLAIN TEXT here, not a
                          `GradeLetter` chip. The chip colour-codes the band (A green,
                          F red), which reads as an on-screen status pill rather than an
                          official mark — and printed, the outline and tint cost ink to
                          say nothing the letter has not already said. `GradeLetter` is
                          deliberately kept for `Session average` below and on screen
                          elsewhere; only this column changed. */}
                      {row.status === 'pending' || !row.letter ? (
                        <Typography variant="body2" color="text.secondary" component="span">
                          —
                        </Typography>
                      ) : (
                        <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                          {row.letter}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}

                {/* Spacer row, then the GPA row — the sample's shape exactly.

                    D39 (Meeting #2): the `GPA` label used to sit in the far-left cell,
                    leaving the whole Course Name column of white space between it and
                    the two numbers it labels. A reader scanning the row met "GPA", then
                    a gap, then `12`, and had to work out that 12 was the credit total
                    and not the GPA. The label now sits in the Instructor column, right
                    up against the figure it names: `12  GPA  2.63`. */}
                <TableRow>
                  <TableCell colSpan={5} sx={{ border: 0, height: 16, p: 0 }} />
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2} />
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {total_credits || '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    GPA
                  </TableCell>
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
              <Typography variant="subtitle2">Session average</Typography>
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

          D39 — the two contact lines were literals (`dean@bajc.edu.bz`,
          `http://www.bajc.edu.bz`) hardcoded from the source PDF, which made every
          school that ever runs this build print BAJC's address. They now fall back to
          `school_profile`'s own contacts, which is the closest thing the table holds;
          the school still has no separate DEAN'S email column, so when it gains one
          this should read that instead. The line is omitted rather than guessed when
          the profile has no email. */}
      <Divider sx={{ mt: 4, mb: 2 }} />
      <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ width: 220, borderBottom: '1px solid', borderColor: 'text.primary', mb: 0.5 }} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Dean
        </Typography>
        {school.email && (
          <Typography variant="caption" color="text.secondary">
            Email: {school.email}
          </Typography>
        )}
        {school.phone && (
          <Typography variant="caption" color="text.secondary">
            Phone: {school.phone}
          </Typography>
        )}
      </Stack>
    </PrintLayout>
  );
}

export default ReportCardDocument;
