import { useMemo, useState } from 'react';
import { Box, Button, Chip, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  DataTable,
  PageContainer,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
  type StatusKind,
} from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { AdmissionsTabs } from '../components/AdmissionsTabs';
import { usePendingApplications, useApplications } from '../hooks/useAdmissions';
import {
  APPLICATION_STATUS_LABEL,
  type ApplicationListItem,
  type ApplicationStatus,
} from '../types';

/**
 * Admissions list (D30 §D11) — Registrar + Dean.
 *
 * `?status=submitted` is the decision queue, so the filter defaults to **Submitted**
 * rather than to everything: the question this screen exists to answer is "what is waiting
 * on us?", and an unfiltered list of drafts and past decisions buries it.
 *
 * The `pending_credit_transfers` count is on the ROW, so the Dean can see where the work
 * is without opening each application (brief §13 — they decide every transfer).
 */
const STATUS_KIND: Record<ApplicationStatus, StatusKind> = {
  draft: 'neutral',
  submitted: 'info',
  under_review: 'warning',
  accepted: 'success',
  denied: 'error',
  withdrawn: 'neutral',
};

const STATUS_OPTIONS: { value: ApplicationStatus | 'all'; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  // D38 — a form being typed today is a PENDING row on its own tab, not a draft here.
  // This filter now reaches only `applications.draft` rows filed before that change.
  { value: 'draft', label: 'Drafts (pre-D38)' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'denied', label: 'Denied' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'all', label: 'All applications' },
];

export function ApplicationsListScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('submitted');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const query = useApplications({
    page: page + 1,
    page_size: pageSize,
    ...(status === 'all' ? {} : { status }),
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  // Page 1 only, for the tab's count. The rows are not rendered here — this is the
  // cheapest honest way to get a total, and the endpoint is the one the tab links to.
  const pendingQuery = usePendingApplications({ page: 1, page_size: 1 });

  const columns = useMemo<DataTableColumn<ApplicationListItem>[]>(
    () => [
      {
        field: 'full_name',
        headerName: 'Applicant',
        primary: true,
        render: (row) => (
          <Stack spacing={0.25}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {row.full_name}
            </Typography>
            {row.email && (
              <Typography variant="caption" color="text.secondary">
                {row.email}
              </Typography>
            )}
          </Stack>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        render: (row) => (
          <StatusBadge
            label={APPLICATION_STATUS_LABEL[row.status]}
            kind={STATUS_KIND[row.status]}
          />
        ),
      },
      {
        field: 'program',
        headerName: 'Programme',
        render: (row) =>
          row.program ? (
            <Tooltip title={row.program.name}>
              <span>{row.program.code}</span>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: 'year_of_study',
        headerName: 'Year / load',
        hideOnMobile: true,
        render: (row) =>
          row.year_of_study || row.enrollment_load
            ? [row.year_of_study, row.enrollment_load].filter(Boolean).join(' · ')
            : '—',
      },
      {
        field: 'pending_credit_transfers',
        headerName: 'Credit transfer',
        align: 'center',
        render: (row) =>
          row.pending_credit_transfers > 0 ? (
            <Tooltip title="Awaiting the Dean's decision. Acceptance is blocked until every request is ruled on.">
              <Chip size="small" color="warning" label={`${row.pending_credit_transfers} pending`} />
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: 'student_code',
        headerName: 'Student ID',
        render: (row) =>
          row.student_id && row.student_code ? (
            // Straight to the student the acceptance created — the question right after
            // "was this accepted?" is always "where is their record?".
            <Button
              size="small"
              component={RouterLink}
              to={`${ROUTES.students}/${row.student_id}`}
              startIcon={<PersonOutlineIcon />}
            >
              {row.student_code}
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
    ],
    [],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Admissions"
        subtitle="Applications to the college — file, review, accept or deny."
        primaryAction={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate(`${ROUTES.applications}/new`)}
          >
            New application
          </Button>
        }
      />

      <AdmissionsTabs value="applications" pendingCount={pendingQuery.data?.total} />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ApplicationStatus | 'all');
            setPage(0);
          }}
          sx={{ minWidth: 200 }}
        >
          {STATUS_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search name, email or student ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 280 }}
        />
        <Box sx={{ flexGrow: 1 }} />
      </Stack>

      <DataTable
        caption="Admission applications"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(row) => row.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={page}
        pageSize={pageSize}
        total={query.data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setPageSize(next);
          setPage(0);
        }}
        emptyTitle="No applications here"
        emptyDescription={
          status === 'submitted'
            ? 'Nothing is waiting on a decision. Saved-but-unsubmitted forms are on the Pending forms tab.'
            : 'File an application to get started.'
        }
        emptyAction={{
          label: 'New application',
          onClick: () => navigate(`${ROUTES.applications}/new`),
        }}
        rowActions={(row) => (
          <Button size="small" component={RouterLink} to={`${ROUTES.applications}/${row.id}`}>
            {row.status === 'draft' ? 'Continue' : 'Review'}
          </Button>
        )}
      />
    </PageContainer>
  );
}

export default ApplicationsListScreen;
