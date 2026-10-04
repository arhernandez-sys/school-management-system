import { Dialog, DialogContent, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import CloseIcon from '@mui/icons-material/Close';
import { PrintLayout, LoadingState, ErrorState, EmptyState } from '@shared/components';
import { surnameFirst } from '@shared/utils/names';
import { useSchoolProfile } from '@features/settings/hooks/useSettings';
import { useStudentsForPrint } from '../hooks/useStudents';
import type { StudentsListParams } from '../types';

export interface StudentListPrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** The list page's CURRENT filters, verbatim. */
  params: StudentsListParams;
  /** Human-readable labels for the active filters, for the printed caption. */
  filterSummary: string[];
}

/**
 * Print the students directory exactly as filtered (D32, brief §3).
 *
 * **Why a dialog and not a print stylesheet on the list page.** The requirement is that
 * the printout match the active filters — but the list on screen is one PAGE of them, and
 * "print all Male students" means all of them, not the 25 currently visible. So the print
 * view re-fetches the same filters with the page size raised, and renders its own table.
 * A `@media print` rule over the paginated table would silently print a quarter of the
 * answer, which is worse than no print button.
 *
 * **The active filters are PRINTED on the sheet.** A page of names with no heading saying
 * what selected them cannot be checked by the person holding it, and is indistinguishable
 * from a printout of the whole school. That caption is the difference between a document
 * and a list of names.
 *
 * Reuses `PrintLayout` — the same wrapper the report card and transcript print through,
 * so the letterhead, the `@media print` rules and the Print button behave identically.
 */
export function StudentListPrintDialog({
  open,
  onClose,
  params,
  filterSummary,
}: StudentListPrintDialogProps) {
  const school = useSchoolProfile();
  const query = useStudentsForPrint(params, open);
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <Stack
        direction="row"
        justifyContent="flex-end"
        className="sis-print-hide"
        sx={{ p: 1, pb: 0 }}
      >
        <IconButton onClick={onClose} aria-label="Close print preview">
          <CloseIcon />
        </IconButton>
      </Stack>
      <DialogContent>
        {query.isLoading ? (
          <LoadingState variant="table" rows={6} label="Preparing the list" />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <PrintLayout
            schoolName={school.data?.name ?? 'Students'}
            documentTitle="Student list"
            logoUrl={school.data?.logo_url}
            meta={
              <>
                <div>
                  {total} student{total === 1 ? '' : 's'}
                </div>
                <div>{formatSchoolDate(new Date())}</div>
              </>
            }
          >
            {/* The filter caption. Printed, never hidden — see the component docstring. */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {filterSummary.length > 0
                ? `Filtered by: ${filterSummary.join(' · ')}`
                : 'All students (no filters applied)'}
            </Typography>

            {/* This dialog asks for 100; the server's ceiling is 200 (`MAX_PAGE_SIZE`).
                Either way the sheet can be short of `total`, and saying so beats a
                silently truncated list that reads as the complete answer. */}
            {total > rows.length && (
              <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                Showing the first {rows.length} of {total}. Narrow the filters to print the
                rest.
              </Typography>
            )}

            {rows.length === 0 ? (
              <EmptyState
                title="No students match these filters"
                description="Adjust the filters and try again."
                variant="card"
              />
            ) : (
              <Table size="small" aria-label="Filtered student list">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Student #</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Year</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Programme</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Gender</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Religion</TableCell>
                    {/* D40 — added with its filter. A sheet headed "Married students"
                        that does not print a civil status cannot be checked by the
                        person holding it, which is the whole reason Gender and Religion
                        are here. Printed AS STORED, not capitalised like Gender: these
                        values are TitleCase in the column already. */}
                    <TableCell sx={{ fontWeight: 600 }}>Civil status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.student_number}</TableCell>
                      {/* D33 ask 5 — the printed register reads the same way as the screen. */}
                      <TableCell>{surnameFirst(s)}</TableCell>
                      <TableCell>{s.year_of_study ?? '—'}</TableCell>
                      <TableCell>{s.program_code ?? '—'}</TableCell>
                      {/* Capitalised for print only; the stored value is lowercase. */}
                      <TableCell sx={{ textTransform: 'capitalize' }}>
                        {s.gender ?? '—'}
                      </TableCell>
                      <TableCell>{s.religion ?? '—'}</TableCell>
                      <TableCell>{s.civil_status ?? '—'}</TableCell>
                      <TableCell sx={{ textTransform: 'capitalize' }}>{s.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PrintLayout>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default StudentListPrintDialog;
