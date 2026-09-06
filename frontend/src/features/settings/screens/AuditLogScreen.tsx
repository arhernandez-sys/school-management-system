import { useMemo, useState } from 'react';
import { MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { DataTable, FilterBar, PageHeader, type DataTableColumn } from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { DateField } from '@shared/components/DateField';
import { formatSchoolDateTime } from '@shared/utils/schoolDate';
import { roleLabel } from '@shared/auth/roleLabels';
import type { Role } from '@shared/types/enums';
import { useAuditLog, type AuditLogItem } from '../hooks/useSettings';

/**
 * The sensitive-action audit trail (D43). Read-only, Dean + Auditor.
 *
 * **This table has been written to since the first release and read by nothing.** Every
 * module calls `_audit()` — role changes, grade revisions, programme edits, user
 * creation, archival — and until D43 there was no endpoint and no screen, so the record
 * existed only in the abstract. It is the one thing an Auditor needs that no existing
 * screen could show them.
 *
 * There is no write path here and there must never be one: an append-only log with an
 * edit button is not evidence of anything.
 */

/** Entity types worth offering as a filter. Free-text `action` covers the long tail. */
/**
 * D44 — `{ value, label }` rather than bare strings.
 *
 * The filter used to render the wire value through `humanizeAction`, which printed
 * "Teacher" — the one place in the frontend still showing that word to a user. The wire
 * value has to stay `teacher` (it is what `audit_log.entity_type` holds), so the label is
 * carried separately instead of being derived from it.
 */
const ENTITY_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'user', label: 'User' },
  { value: 'student', label: 'Student' },
  { value: 'teacher', label: 'Lecturer' },
  { value: 'course', label: 'Course' },
  { value: 'course_offering', label: 'Course offering' },
  { value: 'program', label: 'Programme' },
  { value: 'grade', label: 'Grade' },
  { value: 'academic_year', label: 'Academic year' },
] as const;

/**
 * Turn `program.heads.set` into `Program heads set` — the actions are dotted machine
 * strings and a column of them is hard to scan. The raw value stays available in the
 * tooltip, because an auditor quoting a row wants the string the system actually wrote.
 */
function humanizeAction(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function AuditLogScreen() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const params = useMemo(
    () => ({
      action: debouncedSearch || undefined,
      entity_type: entityType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      page: page + 1,
      page_size: pageSize,
      // Newest first. An audit trail is read backwards from the most recent action, and
      // any other default makes page 1 useless.
      sort: '-created_at',
    }),
    [debouncedSearch, entityType, dateFrom, dateTo, page, pageSize],
  );

  const query = useAuditLog(params);

  const columns: DataTableColumn<AuditLogItem>[] = [
    {
      field: 'created_at',
      headerName: 'When',
      primary: true,
      render: (r) => (
        <Typography variant="body2">{formatSchoolDateTime(r.created_at)}</Typography>
      ),
    },
    {
      field: 'action',
      headerName: 'Action',
      render: (r) => (
        <Tooltip title={r.action}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {humanizeAction(r.action)}
          </Typography>
        </Tooltip>
      ),
    },
    {
      field: 'entity_type',
      headerName: 'Entity',
      render: (r) => <Typography variant="body2">{humanizeAction(r.entity_type)}</Typography>,
    },
    {
      field: 'actor_name',
      headerName: 'By',
      render: (r) =>
        // A deleted account leaves its actions behind (`ON DELETE SET NULL`). Saying so
        // is better than a blank cell, which reads as a rendering fault.
        r.actor_name ? (
          <Typography variant="body2">
            {r.actor_name}
            {r.actor_role ? ` · ${roleLabel(r.actor_role as Role)}` : ''}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled">
            Deleted account
          </Typography>
        ),
    },
    {
      field: 'summary',
      headerName: 'Details',
      hideOnMobile: true,
      render: (r) =>
        r.summary ? (
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
            {JSON.stringify(r.summary)}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every sensitive action the system has recorded, newest first. Read-only."
      />

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchLabel="Action"
        searchPlaceholder="Search actions…"
        filters={
          <>
            <TextField
              select
              size="small"
              label="Entity"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All entities</MenuItem>
              {ENTITY_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>
            {/* D42 — never `<input type="date">`; DateField is the dd/mm/yyyy control. */}
            <DateField
              label="From"
              value={dateFrom}
              onChange={(v) => {
                setDateFrom(v);
                setPage(0);
              }}
            />
            <DateField
              label="To"
              value={dateTo}
              onChange={(v) => {
                setDateTo(v);
                setPage(0);
              }}
            />
          </>
        }
      />

      <DataTable<AuditLogItem>
        caption="Audit log"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(r) => String(r.id)}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={page}
        pageSize={pageSize}
        total={query.data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(ps) => {
          setPageSize(ps);
          setPage(0);
        }}
        sortField="created_at"
        sortDirection="desc"
        emptyTitle="No matching activity"
        emptyDescription="Adjust the filters or widen the date range."
      />
    </>
  );
}

export default AuditLogScreen;
