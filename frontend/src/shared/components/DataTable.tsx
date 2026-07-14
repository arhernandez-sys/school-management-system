import {
  Box,
  Card,
  CardActions,
  CardContent,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { ReactNode } from 'react';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

/**
 * DataTable — canonical server-paginated list surface (design-system §5 #1).
 *
 * Promoted from the Phase-6 stub for the Settings/Subjects module (Phase 7.2). It is
 * deliberately presentational: the caller owns data fetching (a TanStack Query hook),
 * pagination state, and sort state; the table reflects them and emits change events.
 * This keeps server-pagination honest (the parent re-queries on page/sort change) and
 * lets every list screen reuse the same loading / empty / error / success surfaces.
 *
 * Responsive (Phase 2): at >=sm this is a real <table>; below sm it collapses to a
 * vertical stack of outlined cards (one per row) so phones never horizontal-scroll. The
 * card view derives its title from the `primary` column and skips `hideOnMobile` columns.
 * Both breakpoints share the same loading / empty / error / pagination surfaces and the
 * same public props — the collapse is purely presentational.
 *
 * Accessibility: the desktop view is a real <table> with <th scope="col">; sortable
 * headers use MUI TableSortLabel (announces sort direction). The mobile view renders each
 * row as a labelled group with a compact sort control that mirrors the header sort. The
 * busy region is delegated to LoadingState. A `caption` describes the table for readers.
 */
export interface DataTableColumn<Row> {
  /** Stable key; also the server sort field when `sortable`. */
  field: string;
  headerName: string;
  /** Cell renderer. */
  render: (row: Row) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /**
   * Mobile card view only: mark this column as the card TITLE (rendered prominently at the
   * top of each card). If no column is flagged, the first column is used. Ignored on desktop.
   */
  primary?: boolean;
  /** Mobile card view only: omit this column from the card body (for low-value columns). */
  hideOnMobile?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Accessible table caption (visually hidden). */
  caption: string;

  // ── async/server state ─────────────────────────────────────────────────────
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;

  // ── server pagination (0-based page for MUI; convert to 1-based at call site) ─
  page: number;
  pageSize: number;
  total: number;
  rowsPerPageOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;

  // ── server sort ──────────────────────────────────────────────────────────────
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (field: string, direction: 'asc' | 'desc') => void;

  // ── empty-state customization ────────────────────────────────────────────────
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };

  /** Optional per-row trailing actions cell. */
  rowActions?: (row: Row) => ReactNode;
}

export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  caption,
  isLoading = false,
  isError = false,
  onRetry,
  page,
  pageSize,
  total,
  rowsPerPageOptions = [10, 25, 50],
  onPageChange,
  onPageSizeChange,
  sortField,
  sortDirection = 'asc',
  onSortChange,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  rowActions,
}: DataTableProps<Row>) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (isError) {
    return <ErrorState onRetry={onRetry} />;
  }

  const handleSort = (field: string) => {
    if (!onSortChange) return;
    const nextDir: 'asc' | 'desc' =
      sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';
    onSortChange(field, nextDir);
  };

  const colSpan = columns.length + (rowActions ? 1 : 0);

  // Card-view helpers (mobile only).
  const primaryColumn = columns.find((col) => col.primary) ?? columns[0];
  const bodyColumns = columns.filter((col) => col !== primaryColumn && !col.hideOnMobile);
  const sortableColumns = columns.filter((col) => col.sortable);

  const pagination =
    !isLoading && total > 0 ? (
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, newPage) => onPageChange(newPage)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={rowsPerPageOptions}
        onRowsPerPageChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
      />
    ) : null;

  // ── Mobile: a vertical stack of cards ──────────────────────────────────────────
  const mobileView = (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }} aria-label={caption} role="region">
      {isMobile && onSortChange && sortableColumns.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 2, pb: 0 }}>
          <TextField
            select
            size="small"
            label="Sort by"
            value={sortField ?? sortableColumns[0]?.field ?? ''}
            onChange={(e) => onSortChange(e.target.value, sortDirection)}
            sx={{ flex: 1 }}
          >
            {sortableColumns.map((col) => (
              <MenuItem key={col.field} value={col.field}>
                {col.headerName}
              </MenuItem>
            ))}
          </TextField>
          <IconButton
            size="small"
            aria-label={
              sortDirection === 'asc'
                ? 'Sorted ascending — switch to descending'
                : 'Sorted descending — switch to ascending'
            }
            onClick={() =>
              onSortChange(
                sortField ?? sortableColumns[0]?.field ?? '',
                sortDirection === 'asc' ? 'desc' : 'asc',
              )
            }
          >
            {sortDirection === 'asc' ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
          </IconButton>
        </Box>
      )}

      {isLoading ? (
        <Stack spacing={1.5} role="status" aria-busy="true" aria-label="Loading rows" sx={{ p: 2 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={128} />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          variant="card"
        />
      ) : (
        <Stack spacing={1.5} sx={{ p: 2 }}>
          {rows.map((row) => {
            const title = primaryColumn?.render(row);
            const groupLabel = typeof title === 'string' ? title : undefined;
            return (
              <Card
                key={getRowId(row)}
                variant="outlined"
                role="group"
                aria-label={groupLabel}
              >
                <CardContent sx={{ pb: rowActions ? 1 : 2 }}>
                  {primaryColumn && (
                    <Typography
                      variant="subtitle1"
                      component="div"
                      sx={{ fontWeight: 600, mb: bodyColumns.length ? 1.5 : 0 }}
                    >
                      {title}
                    </Typography>
                  )}
                  {bodyColumns.length > 0 && (
                    <Stack spacing={1}>
                      {bodyColumns.map((col) => (
                        <Box
                          key={col.field}
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 2,
                            flexWrap: 'wrap',
                          }}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ flexShrink: 0 }}
                          >
                            {col.headerName}
                          </Typography>
                          <Box
                            sx={{
                              minWidth: 0,
                              textAlign:
                                col.align === 'right'
                                  ? 'right'
                                  : col.align === 'center'
                                    ? 'center'
                                    : 'left',
                              wordBreak: 'break-word',
                            }}
                          >
                            {col.render(row)}
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </CardContent>
                {rowActions && (
                  <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                    {rowActions(row)}
                  </CardActions>
                )}
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );

  // ── Desktop: the canonical table (unchanged from Phase 1) ───────────────────────
  const tableView = (
    <TableContainer sx={{ flex: 1 }}>
      <Table size="small" aria-label={caption}>
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {caption}
        </caption>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.field}
                align={col.align}
                sx={{ width: col.width, whiteSpace: 'nowrap' }}
                sortDirection={sortField === col.field ? sortDirection : false}
                scope="col"
              >
                {col.sortable && onSortChange ? (
                  <TableSortLabel
                    active={sortField === col.field}
                    direction={sortField === col.field ? sortDirection : 'asc'}
                    onClick={() => handleSort(col.field)}
                  >
                    {col.headerName}
                  </TableSortLabel>
                ) : (
                  col.headerName
                )}
              </TableCell>
            ))}
            {rowActions && (
              <TableCell align="right" scope="col">
                Actions
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={colSpan} sx={{ border: 0 }}>
                <LoadingState variant="table" rows={pageSize > 10 ? 8 : pageSize} label="Loading rows" />
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} sx={{ border: 0 }}>
                <EmptyState
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                  variant="card"
                />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={getRowId(row)} hover>
                {columns.map((col) => (
                  <TableCell key={col.field} align={col.align}>
                    {col.render(row)}
                  </TableCell>
                ))}
                {rowActions && (
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                      {rowActions(row)}
                    </Box>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Paper
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {isMobile ? mobileView : tableView}
      {pagination}
    </Paper>
  );
}

export default DataTable;
