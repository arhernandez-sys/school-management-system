import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
  PageContainer,
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { useAuditFilters, useAuditPage, useAuditReports } from './hooks/useAudit';
import { AuditFiltersDialog } from './components/AuditFiltersDialog';
import {
  EMPTY_AUDIT_FILTERS,
  activeAuditFilterCount,
  type AuditFilterValues,
} from './components/auditFilters';
import type { AuditEntry } from './types';

/**
 * The Audit Trail (D45 §46, §53). Dean / Auditor / System Administrator.
 *
 * **WHAT THIS SCREEN IS FOR.** An auditor arrives with questions in the college's
 * language — "who changed this student's grade, when, and why was it allowed?" — and the
 * screen has to answer them without ever making them think about the system. Every row
 * is a sentence naming a person, a date in Belize local time, and what moved from what to
 * what. There is no id, no table name and no JSON anywhere on this page; the server
 * renders all of it (`app/modules/audit/narrative.py`) precisely so that this screen
 * cannot accidentally leak one.
 *
 * The old audit row for the most important event in a college read
 * `grade.update / entity_id f84c4f15-… / {"entries": 3}`. Nobody can audit that, and —
 * more to the point — nobody can CHALLENGE it, which is what an audit trail is for.
 *
 * ⚠️ READ-ONLY BY CONSTRUCTION. There is no action on this page, no export that mutates,
 * and no endpoint behind it that writes. A trail the people it describes can amend is not
 * evidence.
 *
 * **THIS IS NOW THE ONLY AUDIT SCREEN (Sep 2026).** Settings → Audit log used to show the
 * same `audit_log` rows raw — the dotted action key, the entity type, the entity UUID and
 * the summary as JSON — and is deleted. The two things it had that this one did not moved
 * across rather than being lost: `record` (what KIND of record) and `reference` (a handle
 * an auditor can quote). `details` is a third thing NEITHER screen was showing properly —
 * the recorded facts that are not before/after values, which the raw screen buried in
 * JSON and this one used to drop on the floor.
 */
const PAGE_SIZE = 25;

function ChangeTable({ entry }: { entry: AuditEntry }) {
  if (entry.changes.length === 0) return null;
  return (
    <Table size="small" sx={{ mt: 1, maxWidth: 640 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 600 }}>What changed</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Before</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>After</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {entry.changes.map((c) => (
          <TableRow key={c.field}>
            <TableCell>{c.field}</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>{c.previous ?? '—'}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{c.new ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The recorded facts that are not before/after values — see `AuditDetail`. */
function DetailTable({ entry }: { entry: AuditEntry }) {
  if (entry.details.length === 0) return null;
  return (
    <Table size="small" sx={{ mt: 1, maxWidth: 640 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 600 }}>Also recorded</TableCell>
          <TableCell sx={{ fontWeight: 600 }} />
        </TableRow>
      </TableHead>
      <TableBody>
        {entry.details.map((d) => (
          <TableRow key={d.label}>
            <TableCell sx={{ color: 'text.secondary' }}>{d.label}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{d.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EntryCard({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  /**
   * ⚠️ DEFECT FIXED HERE (Sep 2026): "Show detail" did nothing on some rows.
   *
   * This used to read `changes.length > 0 || Boolean(entry.reason) || Boolean(ip_address)`
   * — but the REASON is rendered above, outside the disclosure, and always visible. So on
   * a row whose only extra was a reason (every Dean override writes one), the button
   * appeared, opened an empty Collapse, and toggling it changed nothing but its own
   * label. The collapse was working; there was nothing inside it.
   *
   * The rule now: this expression must name EXACTLY what the Collapse renders, and
   * nothing else. A disclosure that can open onto nothing teaches the auditor to stop
   * opening them, which is worse than not offering it.
   */
  const hasDetail =
    entry.changes.length > 0 || entry.details.length > 0 || Boolean(entry.ip_address);

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardContent sx={{ pb: hasDetail ? 1 : 2, '&:last-child': { pb: hasDetail ? 1 : 2 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'baseline' }}
          justifyContent="space-between"
        >
          <Typography variant="body1" sx={{ flex: 1 }}>
            {entry.description}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
            <Chip size="small" label={entry.module} variant="outlined" />
            {/* What KIND of record, from the merged screen. A second chip rather than a
                line of prose: it is a category, and an auditor scans a column of them. */}
            {entry.record && (
              <Chip size="small" label={entry.record} variant="outlined" color="default" />
            )}
            <Typography variant="caption" color="text.secondary" whiteSpace="nowrap">
              {entry.date} · {entry.time}
            </Typography>
          </Stack>
        </Stack>

        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {entry.what}
          {entry.who_role ? ` · by ${entry.who} (${entry.who_role})` : ` · by ${entry.who}`}
          {entry.context ? ` · ${entry.context}` : ''}
          {/* Always visible, not behind the disclosure: an auditor quoting a row in a
              note needs the handle to hand, and hunting for it is the friction the
              deleted screen's raw UUID column was solving badly. */}
          {` · ${entry.reference}`}
        </Typography>

        {entry.reason && (
          <Alert severity="info" variant="outlined" sx={{ mt: 1, py: 0 }}>
            <Typography variant="body2">
              <strong>Reason given:</strong> {entry.reason}
            </Typography>
          </Alert>
        )}

        {hasDetail && (
          <>
            <Collapse in={open} unmountOnExit>
              <ChangeTable entry={entry} />
              <DetailTable entry={entry} />
              {entry.ip_address && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                  Recorded from {entry.ip_address}
                </Typography>
              )}
            </Collapse>
            <Button
              size="small"
              onClick={() => setOpen((v) => !v)}
              endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ mt: 0.5 }}
            >
              {open ? 'Hide detail' : 'Show detail'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditTrailPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AuditFilterValues>(EMPTY_AUDIT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const query = useMemo(
    () => ({
      report: filters.report || undefined,
      module: filters.module || undefined,
      actor_user_id: filters.actorUserId || undefined,
      search: debouncedSearch || undefined,
      from_date: filters.fromDate || undefined,
      to_date: filters.toDate || undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    [filters, debouncedSearch, page],
  );

  const pageQuery = useAuditPage(query);
  const filtersQuery = useAuditFilters();
  const reportsQuery = useAuditReports();

  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const actors = useMemo(() => filtersQuery.data?.actors ?? [], [filtersQuery.data]);

  const applyFilters = useCallback((next: AuditFilterValues) => {
    setFilters(next);
    setPage(1); // a new filter with the old page number lands on an empty screen
    setFiltersOpen(false);
  }, []);

  const filterCount = activeAuditFilterCount(filters);

  /**
   * The removable chips under the toolbar. Each one names the filter in the auditor's
   * words — the report's NAME, not its key; the person's NAME, not their id — because a
   * chip reading `registration_overrides` explains nothing about why the list is short.
   */
  const appliedChips = useMemo(() => {
    const drop = <K extends keyof AuditFilterValues>(key: K) => () => {
      setFilters((prev) => ({ ...prev, [key]: '' }));
      setPage(1);
    };
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (filters.report) {
      const name = reports.find((r) => r.key === filters.report)?.name ?? filters.report;
      chips.push({ key: 'report', label: name, clear: drop('report') });
    }
    if (filters.module) {
      chips.push({ key: 'module', label: filters.module, clear: drop('module') });
    }
    if (filters.actorUserId) {
      const who = actors.find((a) => a.id === filters.actorUserId);
      chips.push({
        key: 'actor',
        label: `By ${who?.name ?? 'someone'}`,
        clear: drop('actorUserId'),
      });
    }
    if (filters.fromDate) {
      chips.push({ key: 'from', label: `From ${filters.fromDate}`, clear: drop('fromDate') });
    }
    if (filters.toDate) {
      chips.push({ key: 'to', label: `To ${filters.toDate}`, clear: drop('toDate') });
    }
    return chips;
  }, [filters, reports, actors]);

  const clearAll = useCallback(() => {
    setFilters(EMPTY_AUDIT_FILTERS);
    setSearch('');
    setPage(1);
  }, []);

  const data = pageQuery.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <PageContainer>
      <PageHeader
        title="Audit trail"
        subtitle="Every recorded change to academic records — who did it, when, and what changed."
      />
      {/* Toolbar — search + one Filters button, the students directory's pattern
          (client ask, Sep 2026). Six controls in a row squeezed below their minWidth on
          a laptop and became six full-width stacked selects on a phone, which the reader
          had to scroll past before reaching a single entry. Everything except search is
          in the modal; search stays here because it is typed continuously. */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <TextField
            label="Search"
            type="search"
            size="small"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="A student, a course, a reason…"
            sx={{ flexGrow: 1, minWidth: { sm: 240 } }}
          />
          <Badge badgeContent={filterCount} color="primary" overlap="rectangular">
            <Button
              variant="outlined"
              startIcon={<FilterListIcon />}
              onClick={() => setFiltersOpen(true)}
              fullWidth
              sx={{ whiteSpace: 'nowrap' }}
            >
              Filters
            </Button>
          </Badge>
        </Stack>

        {(appliedChips.length > 0 || Boolean(debouncedSearch)) && (
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', mt: 2, alignItems: 'center' }}
          >
            {debouncedSearch && (
              <Chip
                size="small"
                label={`Search "${debouncedSearch}"`}
                onDelete={() => {
                  setSearch('');
                  setPage(1);
                }}
              />
            )}
            {appliedChips.map((c) => (
              <Chip key={c.key} size="small" label={c.label} onDelete={c.clear} />
            ))}
            <Button size="small" onClick={clearAll}>
              Clear all
            </Button>
          </Stack>
        )}
      </Paper>

      <AuditFiltersDialog
        open={filtersOpen}
        value={filters}
        onApply={applyFilters}
        onClose={() => setFiltersOpen(false)}
        reports={reports}
        modules={filtersQuery.data?.modules ?? []}
        actors={actors}
      />

      {pageQuery.isLoading ? (
        <LoadingState variant="cards" rows={5} label="Loading the audit trail" />
      ) : pageQuery.isError ? (
        <ErrorState onRetry={() => void pageQuery.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Nothing recorded for these filters"
          description="Try a wider date range, a different area, or clear the filters."
          variant="page"
        />
      ) : (
        <>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
            sx={{ mb: 1 }}
          >
            <Typography variant="body2" color="text.secondary">
              {data.total.toLocaleString()} recorded {data.total === 1 ? 'action' : 'actions'}
            </Typography>
          </Stack>

          {data.includes_pre_phase7_rows && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Some of these actions were recorded before the system began keeping
              before-and-after values. For those, the person, the time and what was done are
              accurate, but the previous value was never captured and cannot be shown.
            </Alert>
          )}

          {data.items.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}

          <Divider sx={{ my: 2 }} />
          <Box display="flex" justifyContent="center">
            <Pagination
              count={pageCount}
              page={data.page}
              onChange={(_e, p) => setPage(p)}
              color="primary"
            />
          </Box>
        </>
      )}
    </PageContainer>
  );
}

export default AuditTrailPage;
