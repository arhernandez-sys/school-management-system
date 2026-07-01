import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
} from '@mui/material';
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
 * Accessibility: a real <table> with <th scope="col">; sortable headers use
 * MUI TableSortLabel (announces sort direction); the busy region is delegated to
 * LoadingState. A `caption` describes the table for screen readers.
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

  return (
    <Paper variant="outlined">
      <TableContainer>
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
                  sx={{ width: col.width, fontWeight: 600, whiteSpace: 'nowrap' }}
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
                <TableCell align="right" scope="col" sx={{ fontWeight: 600 }}>
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
      {!isLoading && total > 0 && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => onPageChange(newPage)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={rowsPerPageOptions}
          onRowsPerPageChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
        />
      )}
    </Paper>
  );
}

export default DataTable;
