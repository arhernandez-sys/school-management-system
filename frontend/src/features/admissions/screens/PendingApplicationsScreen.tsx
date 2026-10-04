import { useMemo, useState } from 'react';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import { Button, Chip, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  ConfirmDialog,
  DataTable,
  PageContainer,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { AdmissionsTabs } from '../components/AdmissionsTabs';
import { useDeletePendingApplication, usePendingApplications } from '../hooks/useAdmissions';
import type { PendingApplicationListItem } from '../types';

/**
 * Pending forms (D38) — saved admission forms that have not been submitted.
 *
 * **The scope is the server's, and it is per-row.** A Registrar sees only the forms they
 * filed; the Dean sees everyone's. Nothing here narrows the list client-side, because a
 * client-side scope is not a scope — someone else's row answers 404 on every endpoint.
 *
 * The **Who filed it** column therefore only appears for the Dean. For a Registrar it would
 * be their own name on every row, which is a column that costs width and says nothing.
 *
 * `blocking_issues` is on the row, so this list answers "which of these can I actually
 * submit?" without opening any of them. That is the question the screen exists for: these
 * are forms someone stopped in the middle of, and the reason they stopped is usually a
 * missing piece the applicant still has to supply.
 */
export function PendingApplicationsScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // `principal` is the Dean in this deployment (D30 renamed the label, not the role).
  const isDean = user?.role === 'principal';

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [toDiscard, setToDiscard] = useState<PendingApplicationListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = usePendingApplications({
    page: page + 1,
    page_size: pageSize,
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
  });
  const deleteMut = useDeletePendingApplication();

  const columns = useMemo<DataTableColumn<PendingApplicationListItem>[]>(() => {
    const cols: DataTableColumn<PendingApplicationListItem>[] = [
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
        field: 'blocking_issues',
        headerName: 'Ready?',
        render: (row) =>
          row.blocking_issues.length === 0 ? (
            <StatusBadge label="Ready to submit" kind="success" />
          ) : (
            // The reasons themselves, in the tooltip. The count alone would send the
            // Registrar into the wizard to find out what it stands for.
            <Tooltip
              title={
                <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                  {row.blocking_issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </Stack>
              }
            >
              <Chip
                size="small"
                color="warning"
                label={`${row.blocking_issues.length} missing`}
              />
            </Tooltip>
          ),
      },
      {
        field: 'program',
        headerName: 'Programme',
        hideOnMobile: true,
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
        field: 'updated_at',
        headerName: 'Last saved',
        hideOnMobile: true,
        render: (row) => (
          <Typography variant="body2">
            {formatSchoolDate(row.updated_at)}
          </Typography>
        ),
      },
    ];

    if (isDean) {
      cols.splice(2, 0, {
        field: 'created_by_name',
        headerName: 'Filed by',
        hideOnMobile: true,
        render: (row) => (
          <Typography variant="body2">{row.created_by_name ?? '—'}</Typography>
        ),
      });
    }
    return cols;
  }, [isDean]);

  const discard = () => {
    if (!toDiscard) return;
    setError(null);
    deleteMut.mutate(toDiscard.id, {
      onSuccess: () => setToDiscard(null),
      onError: (err) => setError(apiErrorMessage(err)),
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Admissions"
        subtitle={
          isDean
            ? 'Saved forms that have not been submitted yet — every Registrar’s.'
            : 'Saved forms that have not been submitted yet — the ones you filed.'
        }
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

      <AdmissionsTabs value="pending" pendingCount={query.data?.total} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search name or email"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 280 }}
        />
      </Stack>

      <DataTable
        caption="Pending admission forms"
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
        emptyTitle="Nothing saved and unsubmitted"
        emptyDescription={
          isDean
            ? 'No Registrar has a form part-way through. Saved forms appear here until they are submitted.'
            : 'Forms you save without submitting appear here until you finish them.'
        }
        emptyAction={{
          label: 'New application',
          onClick: () => navigate(`${ROUTES.applications}/new`),
        }}
        rowActions={(row) => (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              component={RouterLink}
              to={`${ROUTES.applications}/pending/${row.id}/edit`}
            >
              Continue
            </Button>
            <Tooltip title="Discard this form">
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setToDiscard(row)}
                aria-label={`Discard the form for ${row.full_name}`}
              >
                Discard
              </Button>
            </Tooltip>
          </Stack>
        )}
      />

      <ConfirmDialog
        open={Boolean(toDiscard)}
        title="Discard this form?"
        /* Says "permanently" because it means it — a pending form is hard-deleted, unlike
           an application, since there is no admissions record to keep. */
        description={
          toDiscard
            ? `${toDiscard.full_name}’s form has not been submitted. Discarding it deletes it permanently.`
            : ''
        }
        confirmLabel="Discard"
        destructive
        error={error}
        pending={deleteMut.isPending}
        onConfirm={discard}
        onCancel={() => {
          setToDiscard(null);
          setError(null);
        }}
      />
    </PageContainer>
  );
}

export default PendingApplicationsScreen;
