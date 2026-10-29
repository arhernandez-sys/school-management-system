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
import type { AssessmentReportParams, GradebookCell } from '../types';
import { formatNumeric } from './gradeDisplay';

export interface AssessmentReportPrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** The Grades page's CURRENT filters. A lecturer's are narrowed server-side anyway. */
  params: AssessmentReportParams;
  /** Human-readable labels for the active filters, printed as the caption. */
  filterSummary: string[];
}

/** What one printed cell says. "0*" marks an automatic zero, explained in the key. */
function cellText(cell: GradebookCell | undefined): string {
  if (!cell) return '';
  if (cell.status === 'graded' && cell.score != null) return String(cell.score);
  if (cell.auto_zero) return '0*';
  if (cell.status === 'excused' || cell.status === 'exempt') return 'Exc';
  if (cell.status === 'absent') return 'Abs';
  return '—';
}

/**
 * D47 — print the assessment report exactly as filtered on the Grades page.
 *
 * One section per course offering: its assessments as columns, every student as a row with
 * their marks and current %. The numbers come from the server's gradebook, so paper and
 * screen agree. Same dialog-with-its-own-fetch pattern as the D43 list prints
 * (`OfferingListPrintDialog`) and the same `window.print()` route to paper or PDF.
 */
export function AssessmentReportPrintDialog({
  open,
  onClose,
  params,
  filterSummary,
}: AssessmentReportPrintDialogProps) {
  const school = useSchoolProfile();
  const query = useAssessmentReport(params, open);
  const report = query.data;
  const sections = report?.offerings ?? [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
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
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {filterSummary.length > 0 ? `Filtered by: ${filterSummary.join(' · ')}` : 'No filters applied'}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
              0* = no mark entered before marking closed (counts as 0) · Exc = excused · — = not
              yet marked · % = current course percentage
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
            ) : (
              sections.map((section, idx) => {
                const lecturers = section.offering?.teachers.map((t) => t.full_name).join(', ');
                return (
                  <Box
                    key={section.offering?.offering.id ?? idx}
                    sx={{ mb: 4, breakInside: 'avoid-page', pageBreakBefore: idx > 0 ? 'always' : 'auto' }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {section.offering?.offering.course.name ?? 'Course'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {[section.offering?.offering.label, section.semester?.name, lecturers]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                    {section.rows.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No students to show.
                      </Typography>
                    ) : section.assessments.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No assessments yet.
                      </Typography>
                    ) : (
                      <Box sx={{ overflowX: 'auto' }}>
                        <Table size="small" aria-label={`${section.offering?.offering.label ?? 'Course'} assessments`}>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 600 }}>Student</TableCell>
                              {section.assessments.map((a) => (
                                <TableCell key={a.id} align="right" sx={{ fontWeight: 600, verticalAlign: 'bottom' }}>
                                  <div>{a.title}</div>
                                  <Typography variant="caption" color="text.secondary" component="div">
                                    /{a.max_score}
                                    {a.assessment_date ? ` · ${formatSchoolDate(a.assessment_date)}` : ''}
                                  </Typography>
                                </TableCell>
                              ))}
                              <TableCell align="right" sx={{ fontWeight: 600 }}>
                                %
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {section.rows.map((row) => (
                              <TableRow key={row.student.id}>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                  {row.student.full_name}
                                  <Typography variant="caption" color="text.secondary" component="div">
                                    {row.student.student_number}
                                  </Typography>
                                </TableCell>
                                {section.assessments.map((a) => (
                                  <TableCell key={a.id} align="right">
                                    {cellText(row.cells.find((c) => c.assessment_id === a.id))}
                                  </TableCell>
                                ))}
                                <TableCell align="right" sx={{ fontWeight: 600 }}>
                                  {formatNumeric(row.term_numeric)}
                                  {row.term_letter ? ` (${row.term_letter})` : ''}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    )}
                  </Box>
                );
              })
            )}
          </PrintLayout>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AssessmentReportPrintDialog;
