import {
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
import { formatSchoolDate } from '@shared/utils/schoolDate';
import { PrintLayout, LoadingState, ErrorState, EmptyState } from '@shared/components';
import { useSchoolProfile } from '../hooks/useSettings';
import { useCoursesForPrint, type CoursesListParams } from '../hooks/useCourses';

export interface CourseListPrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** The catalog page's CURRENT filters, verbatim. */
  params: CoursesListParams;
  /** Human-readable labels for the active filters, for the printed caption. */
  filterSummary: string[];
}

/**
 * Print the course catalog exactly as filtered (D43).
 *
 * Follows `StudentListPrintDialog` deliberately — same argument, same shape. A
 * `@media print` rule over the paginated table would print whichever 25 rows the table
 * happens to be showing and present them as the catalog, so the print view re-fetches
 * the caller's filters at a raised page size and renders its own table.
 *
 * **The active filters are printed on the sheet.** A page of course codes with no heading
 * saying what selected them is indistinguishable from a printout of the whole catalog,
 * and cannot be checked by the person holding it.
 *
 * Unlike the students sheet this one carries the full letterhead (`contactLines`) — the
 * catalog is the sort of document that leaves the building, and the report card already
 * set that precedent.
 */
export function CourseListPrintDialog({
  open,
  onClose,
  params,
  filterSummary,
}: CourseListPrintDialogProps) {
  const school = useSchoolProfile();
  const query = useCoursesForPrint(params, open);
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
          <LoadingState variant="table" rows={6} label="Preparing the catalog" />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <PrintLayout
            schoolName={school.data?.name ?? 'Course catalog'}
            documentTitle="Course catalog"
            logoUrl={school.data?.logo_url}
            contactLines={[
              school.data?.address,
              school.data?.contact_phone,
              school.data?.contact_email,
            ]}
            meta={
              <>
                <div>
                  {total} course{total === 1 ? '' : 's'}
                </div>
                <div>{formatSchoolDate(new Date())}</div>
              </>
            }
          >
            {/* The filter caption. Printed, never hidden — see the component docstring. */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {filterSummary.length > 0
                ? `Filtered by: ${filterSummary.join(' · ')}`
                : 'All active courses (no filters applied)'}
            </Typography>

            {/* The server caps `page_size` at 200. Saying so beats a silently short sheet
                that reads as the complete answer. */}
            {total > rows.length && (
              <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                Showing the first {rows.length} of {total}. Narrow the filters to print the
                rest.
              </Typography>
            )}

            {rows.length === 0 ? (
              <EmptyState
                title="No courses match these filters"
                description="Adjust the filters and try again."
                variant="card"
              />
            ) : (
              <Table size="small" aria-label="Filtered course catalog">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Course</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">
                      Credits
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Component</TableCell>
                    {/* Printed even when the sheet is active-only: "Status" is the column
                        that makes a retired course legible on paper, and the caption above
                        is the only other place that distinction appears. */}
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.code}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell align="right">{c.credits}</TableCell>
                      <TableCell>{c.component ?? '—'}</TableCell>
                      <TableCell>{c.is_active ? 'Active' : 'Retired'}</TableCell>
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

export default CourseListPrintDialog;
