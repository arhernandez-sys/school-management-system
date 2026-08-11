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
 * ReportCardDocument — the printable report card (design-system §7.8). Renders the
 * school-identity header, student info, the section's per-subject term grades
 * (numeric + letter + teacher), an attendance summary and the term average, all inside
 * `PrintLayout` so browser print (D27) produces the export.
 */
export interface ReportCardDocumentProps {
  data: ReportCard;
}

export function ReportCardDocument({ data }: ReportCardDocumentProps) {
  const { student, school, semester, subjects, attendance_summary, term_average, term_average_letter } =
    data;

  const documentTitle = `Report Card — ${semester.name}, ${semester.academic_year_name}`;

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
          {student.year_group && <div>{student.year_group}</div>}
        </>
      }
    >
      {/* Student header */}
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h4" component="h2">
          {student.full_name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {student.year_group ?? '—'}
        </Typography>
      </Stack>

      {subjects.length === 0 ? (
        <EmptyState
          title="No subjects to report"
          description="This student is not enrolled in any subject classes for the selected term."
          variant="card"
        />
      ) : (
        <>
          <TableContainer>
            <Table size="small" aria-label="Subject grades">
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
                {subjects.map((row) => (
                  <TableRow key={row.subject.id}>
                    <TableCell>{row.subject.name}</TableCell>
                    <TableCell align="right">
                      {row.status === 'pending' || row.numeric == null ? (
                        <Typography variant="body2" color="text.secondary" component="span">
                          Pending
                        </Typography>
                      ) : (
                        row.numeric.toFixed(1)
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {row.status === 'pending' ? (
                        <Typography variant="body2" color="text.secondary" component="span">
                          —
                        </Typography>
                      ) : (
                        <GradeLetter letter={row.letter} />
                      )}
                    </TableCell>
                    <TableCell>{row.teacher ?? '—'}</TableCell>
                  </TableRow>
                ))}
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
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: { sm: 'flex-end' } }}>
                <Typography variant="h4" component="span">
                  {term_average != null ? term_average.toFixed(1) : '—'}
                </Typography>
                {term_average_letter && <GradeLetter letter={term_average_letter} />}
              </Stack>
            </Box>
          </Stack>
        </>
      )}
    </PrintLayout>
  );
}

export default ReportCardDocument;
