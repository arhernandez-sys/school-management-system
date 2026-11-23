import {
  Box,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { EmptyState, ErrorState, LoadingState, PrintLayout } from '@shared/components';
import { useSchoolProfile } from '@features/settings/hooks/useSettings';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import { useAssessmentReport } from '../hooks/useGrades';
import type {
  AssessmentReportColumn,
  AssessmentReportOffering,
  AssessmentReportParams,
  AssessmentReportRow,
  GradebookCell,
} from '../types';
import { formatNumeric } from './gradeDisplay';

export interface AssessmentReportPrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** The Grades page's CURRENT filters. A lecturer's are narrowed server-side anyway. */
  params: AssessmentReportParams;
  /** Human-readable labels for the active filters, printed as the caption. */
  filterSummary: string[];
  /**
   * How the pages are grouped. `offering` (the lecturer's print): one course per page, then
   * each student under it. `student` (the Dean's print): one student per page, then each of
   * their courses under it. The table under every student-in-a-course is the same.
   */
  groupBy?: 'offering' | 'student';
}

/**
 * Letter portrait, half-inch margins. The old report put every assessment in a COLUMN, so
 * a course with many assessments ran off the right edge of the paper; the table now runs
 * DOWN (one row per assessment), which fits any count.
 */
const PAGE_CSS = `
@media print {
  @page { size: letter portrait; margin: 0.5in; }
}
`;

/** One printed assessment line for one student. */
interface LineCells {
  points: string;
  grade: string;
  remark: string;
  status: string;
}

/**
 * Has a result been RECORDED for the grade? A graded mark, an absence, an excusal, or an
 * automatic zero (blank after marking closed — it counts). A blank still inside its
 * marking window has not been recorded yet and is left off the sheet.
 */
function isRecorded(cell: GradebookCell | undefined): cell is GradebookCell {
  return Boolean(cell && (cell.status !== 'pending' || cell.auto_zero));
}

function lineFor(cell: GradebookCell): LineCells {
  if (cell.auto_zero) {
    return { points: '0', grade: '—', remark: 'No mark entered before marking closed', status: 'Counted as 0' };
  }
  switch (cell.status) {
    case 'graded':
      return {
        points: cell.score != null ? String(cell.score) : '—',
        grade: cell.letter ?? '—',
        remark: '',
        status: 'Recorded',
      };
    case 'absent':
      return cell.makeup_score != null
        ? { points: String(cell.makeup_score), grade: '—', remark: 'Absent — makeup taken', status: 'Recorded' }
        : { points: '—', grade: '—', remark: 'Absent', status: 'Recorded' };
    case 'excused':
      return { points: '—', grade: '—', remark: 'Excused — not counted', status: 'Recorded' };
    case 'exempt':
      return { points: '—', grade: '—', remark: 'Exempt — not counted', status: 'Recorded' };
    default:
      return { points: '—', grade: '—', remark: '', status: 'Recorded' };
  }
}

const cellSx = { py: 0.4, px: 0.75, fontSize: 12, lineHeight: 1.3 } as const;
const headSx = { ...cellSx, fontWeight: 700, whiteSpace: 'nowrap' } as const;

/** Course on the LEFT, lecturer(s) on the RIGHT — the header of every course block. */
function OfferingHeader({ section }: { section: AssessmentReportOffering }) {
  const lecturers = section.offering?.teachers.map((t) => t.full_name).join(', ');
  const course = section.offering?.offering;
  return (
    <Stack
      direction="row"
      sx={{ justifyContent: 'space-between', alignItems: 'baseline', columnGap: 2, borderBottom: 2, borderColor: 'text.primary', pb: 0.5, mb: 1 }}
    >
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
          {course?.label ?? 'Course offering'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {[course?.course.name, section.semester?.name].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ textAlign: 'right' }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Lecturer:{' '}
        </Box>
        {lecturers || '—'}
      </Typography>
    </Stack>
  );
}

/** One student's recorded assessments in one course, as a table running down the page. */
function StudentAssessmentTable({
  assessments,
  row,
  title,
}: {
  assessments: AssessmentReportColumn[];
  row: AssessmentReportRow;
  /** The line above the table — the student in the lecturer's print, nothing in the Dean's. */
  title?: React.ReactNode;
}) {
  const lines = assessments
    .map((a) => ({ a, cell: row.cells.find((c) => c.assessment_id === a.id) }))
    .filter((l): l is { a: AssessmentReportColumn; cell: GradebookCell } => isRecorded(l.cell));

  return (
    <Box sx={{ mb: 2, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      {title}
      {lines.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
          No assessments recorded yet.
        </Typography>
      ) : (
        <Table size="small" sx={{ tableLayout: 'auto', '& td, & th': { borderColor: 'divider' } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={headSx}>Date</TableCell>
              <TableCell sx={headSx}>Type</TableCell>
              <TableCell sx={headSx}>Title</TableCell>
              <TableCell sx={headSx} align="right">Total pts</TableCell>
              <TableCell sx={headSx} align="right">Pts recorded</TableCell>
              <TableCell sx={headSx} align="center">Grade</TableCell>
              <TableCell sx={headSx}>Remark</TableCell>
              <TableCell sx={headSx}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map(({ a, cell }) => {
              const line = lineFor(cell);
              return (
                <TableRow key={a.id}>
                  <TableCell sx={{ ...cellSx, whiteSpace: 'nowrap' }}>
                    {a.assessment_date ? formatSchoolDate(a.assessment_date) : '—'}
                  </TableCell>
                  <TableCell sx={cellSx}>{a.category_name ?? '—'}</TableCell>
                  <TableCell sx={cellSx}>{a.title}</TableCell>
                  <TableCell sx={cellSx} align="right">{a.max_score}</TableCell>
                  <TableCell sx={cellSx} align="right">{line.points}</TableCell>
                  <TableCell sx={cellSx} align="center">{line.grade}</TableCell>
                  <TableCell sx={cellSx}>{line.remark}</TableCell>
                  <TableCell sx={{ ...cellSx, whiteSpace: 'nowrap' }}>{line.status}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Typography variant="body2" sx={{ textAlign: 'right', fontSize: 12, mt: 0.5, fontWeight: 600 }}>
        Course grade: {row.term_numeric != null ? `${formatNumeric(row.term_numeric)}%` : '—'}
        {row.term_letter ? ` (${row.term_letter})` : ''}
      </Typography>
    </Box>
  );
}

function StudentLine({ row }: { row: AssessmentReportRow }) {
  return (
    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
      {row.student.full_name}
      <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
        {' '}· {row.student.student_number}
      </Box>
    </Typography>
  );
}

/** LECTURER: course → each student → their table. One course per page. */
function ByOffering({ sections }: { sections: AssessmentReportOffering[] }) {
  return (
    <>
      {sections.map((section, idx) => (
        <Box
          key={section.offering?.offering.id ?? idx}
          sx={{ mb: 4, pageBreakBefore: idx > 0 ? 'always' : 'auto', breakBefore: idx > 0 ? 'page' : 'auto' }}
        >
          <OfferingHeader section={section} />
          {section.rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No students to show.
            </Typography>
          ) : (
            section.rows.map((row) => (
              <StudentAssessmentTable
                key={row.student.id}
                assessments={section.assessments}
                row={row}
                title={<StudentLine row={row} />}
              />
            ))
          )}
        </Box>
      ))}
    </>
  );
}

/** DEAN: student → each of their courses → the same table. One student per page. */
function ByStudent({ sections }: { sections: AssessmentReportOffering[] }) {
  const students = new Map<string, { row: AssessmentReportRow; items: { section: AssessmentReportOffering; row: AssessmentReportRow }[] }>();
  for (const section of sections) {
    for (const row of section.rows) {
      const entry = students.get(row.student.id) ?? { row, items: [] };
      entry.items.push({ section, row });
      students.set(row.student.id, entry);
    }
  }
  const ordered = [...students.values()].sort((a, b) =>
    a.row.student.full_name.localeCompare(b.row.student.full_name),
  );
  if (ordered.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No students to show.
      </Typography>
    );
  }
  return (
    <>
      {ordered.map(({ row, items }, idx) => (
        <Box
          key={row.student.id}
          sx={{ mb: 4, pageBreakBefore: idx > 0 ? 'always' : 'auto', breakBefore: idx > 0 ? 'page' : 'auto' }}
        >
          <Box sx={{ bgcolor: 'action.hover', px: 1, py: 0.75, mb: 1.5, borderRadius: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {row.student.full_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Student ID {row.student.student_number} · {items.length} course
              {items.length === 1 ? '' : 's'}
            </Typography>
          </Box>
          {items.map(({ section, row: courseRow }, i) => (
            <Box key={section.offering?.offering.id ?? i} sx={{ mb: 1.5 }}>
              <OfferingHeader section={section} />
              <StudentAssessmentTable assessments={section.assessments} row={courseRow} />
            </Box>
          ))}
        </Box>
      ))}
    </>
  );
}

/**
 * D47 — print the assessment report exactly as filtered on the Grades page.
 *
 * Each student's results in a course are a table running DOWN the page — date, type, title,
 * total points, points recorded, grade, remark, status — so it fits letter paper however
 * many assessments a course has. Only results already recorded for the grade are listed.
 * The numbers come from the server's gradebook, so paper and screen agree. Same
 * dialog-with-its-own-fetch pattern as the D43 list prints and the same `window.print()`.
 */
export function AssessmentReportPrintDialog({
  open,
  onClose,
  params,
  filterSummary,
  groupBy = 'offering',
}: AssessmentReportPrintDialogProps) {
  const school = useSchoolProfile();
  const query = useAssessmentReport(params, open);
  const report = query.data;
  const sections = report?.offerings ?? [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <style>{PAGE_CSS}</style>
      <Stack direction="row" justifyContent="flex-end" className="sis-print-hide" sx={{ p: 1, pb: 0 }}>
        <IconButton onClick={onClose} aria-label="Close print preview">
          <CloseIcon />
        </IconButton>
      </Stack>
      <DialogContent>
        {query.isLoading ? (
          <LoadingState variant="table" rows={6} label="Preparing the report" />
        ) : query.isError || !report ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <PrintLayout
            schoolName={school.data?.name ?? 'Assessments'}
            documentTitle="Assessment report"
            logoUrl={school.data?.logo_url}
            contactLines={[school.data?.address, school.data?.contact_phone, school.data?.contact_email]}
            meta={
              <>
                <div>
                  {report.total_offerings} course offering{report.total_offerings === 1 ? '' : 's'}
                </div>
                <div>{formatSchoolDate(report.generated_at)}</div>
              </>
            }
          >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {filterSummary.length > 0 ? `Filtered by: ${filterSummary.join(' · ')}` : 'No filters applied'}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
              Only assessments with a recorded result are listed. "Counted as 0" = no mark was
              entered before marking closed. Course grade = the current course percentage.
            </Typography>
            {report.truncated && (
              <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                Showing the first {sections.length} of {report.total_offerings} course offerings.
                Narrow the filters to print the rest.
              </Typography>
            )}

            {sections.length === 0 ? (
              <EmptyState
                title="Nothing matches these filters"
                description="Adjust the filters and try again."
                variant="card"
              />
            ) : groupBy === 'student' ? (
              <ByStudent sections={sections} />
            ) : (
              <ByOffering sections={sections} />
            )}
          </PrintLayout>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AssessmentReportPrintDialog;
