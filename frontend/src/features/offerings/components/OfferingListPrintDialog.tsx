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
import { useSchoolProfile } from '@features/settings/hooks/useSettings';
import { useOfferingsForPrint } from '../hooks/useOfferings';
import { summarizeMeetings } from '../meetingFormat';
import type { OfferingListParams } from '../types';

export interface OfferingListPrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** The list page's CURRENT filters, verbatim. */
  params: OfferingListParams;
  /** Human-readable labels for the active filters, for the printed caption. */
  filterSummary: string[];
}

/**
 * Print the course-offering schedule exactly as filtered (D43).
 *
 * The companion to `CourseListPrintDialog`: that one prints what a course IS, this one
 * prints when it is actually taught and by whom. "All Semester 1 2026 offerings" is the
 * sheet a registrar really wants on paper, and it is the reason the filters are the point
 * rather than an afterthought — see that component's docstring for why this is a dialog
 * with its own fetch and not a `@media print` rule over the paginated table.
 *
 * **Scope note.** The server scopes `/offerings` per caller, so a lecturer printing this
 * gets their own teaching load rather than the college's. That is correct, and the caption
 * says "no filters applied" rather than "all offerings" so the sheet never overclaims.
 */
export function OfferingListPrintDialog({
  open,
  onClose,
  params,
  filterSummary,
}: OfferingListPrintDialogProps) {
  const school = useSchoolProfile();
  const query = useOfferingsForPrint(params, open);
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
          <LoadingState variant="table" rows={6} label="Preparing the schedule" />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <PrintLayout
            schoolName={school.data?.name ?? 'Course offerings'}
            documentTitle="Course offerings"
            logoUrl={school.data?.logo_url}
            contactLines={[
              school.data?.address,
              school.data?.contact_phone,
              school.data?.contact_email,
            ]}
            meta={
              <>
                <div>
                  {total} offering{total === 1 ? '' : 's'}
                </div>
                <div>{formatSchoolDate(new Date())}</div>
              </>
            }
          >
            {/* The filter caption. Printed, never hidden. */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {filterSummary.length > 0
                ? `Filtered by: ${filterSummary.join(' · ')}`
                : 'No filters applied'}
            </Typography>

            {/* The offerings list really can exceed the server's 200-row ceiling in a busy
                term, so this warning is load-bearing rather than defensive. */}
            {total > rows.length && (
              <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                Showing the first {rows.length} of {total}. Narrow the filters to print the
                rest.
              </Typography>
            )}

            {rows.length === 0 ? (
              <EmptyState
                title="No offerings match these filters"
                description="Adjust the filters and try again."
                variant="card"
              />
            ) : (
              <Table size="small" aria-label="Filtered course offerings">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Offering</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Course</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Session</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Lecturer</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Schedule</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">
                      Enrolled
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((o) => (
                    <TableRow key={o.id}>
                      {/* The server-computed label — an offering row stores no name, so
                          there is nothing else to print and nothing to re-derive here. */}
                      <TableCell>{o.label}</TableCell>
                      <TableCell>{o.course?.name ?? '—'}</TableCell>
                      <TableCell>{o.semester?.name ?? '—'}</TableCell>
                      {/* Every assigned lecturer, not just the lead: a co-taught offering
                          that prints one name misattributes the other's work. */}
                      <TableCell>
                        {o.teachers.length > 0
                          ? o.teachers.map((t) => t.full_name).join(', ')
                          : 'Unassigned'}
                      </TableCell>
                      <TableCell>{summarizeMeetings(o.meetings) ?? '—'}</TableCell>
                      <TableCell align="right">
                        {o.enrolled_count}
                        {o.capacity != null ? `/${o.capacity}` : ''}
                      </TableCell>
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

export default OfferingListPrintDialog;
