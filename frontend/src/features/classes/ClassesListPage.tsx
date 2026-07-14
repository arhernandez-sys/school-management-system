import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Link as MuiLink, Typography } from '@mui/material';
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce } from '@shared/hooks';
import { ROUTES } from '@shared/constants/routes';
import { useAuth } from '@features/auth/hooks/useAuth';
import { useClassesList } from './hooks/useClasses';
import type { ClassListItem } from './types';

/**
 * Classes (sections) list (api-spec §5 GET /classes, ui-design-system §7.5). A class is
 * a multi-subject SECTION/homeroom (D23): one roster, many subjects. Rows link to the
 * section detail. Capacity is shown as `enrolled/capacity`; over-capacity surfaces a
 * warn-only "Over capacity" chip (D-Q6) — it never blocks.
 *
 * Scope is server-enforced (P/S = all, Teacher = own, Student = enrolled); this screen
 * just renders whatever the API returns.
 */
export function ClassesListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: 'name',
    }),
    [debouncedSearch, page, pageSize],
  );

  const query = useClassesList(params);

  const goToClass = (id: string) => navigate(`${ROUTES.classes}/${id}`);

  const columns: DataTableColumn<ClassListItem>[] = [
    {
      field: 'name',
      headerName: 'Class',
      sortable: true,
      primary: true,
      render: (c) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => goToClass(c.id)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {c.name}
        </MuiLink>
      ),
    },
    {
      field: 'grade_level',
      headerName: 'Grade',
      sortable: true,
      render: (c) => <Typography variant="body2">{c.grade_level}</Typography>,
    },
    {
      field: 'subject_count',
      headerName: 'Subjects',
      align: 'right',
      render: (c) => <Typography variant="body2">{c.subject_count}</Typography>,
    },
    {
      field: 'enrolled_count',
      headerName: 'Enrolled',
      align: 'right',
      render: (c) => {
        const over = c.capacity > 0 && c.enrolled_count > c.capacity;
        return (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}
          >
            <Typography variant="body2" component="span">
              {c.enrolled_count}
              {c.capacity > 0 ? `/${c.capacity}` : ''}
            </Typography>
            {over && <StatusBadge label="Over capacity" kind="warning" />}
          </Box>
        );
      },
    },
    {
      field: 'is_archived',
      headerName: 'Status',
      render: (c) =>
        c.is_archived ? (
          <StatusBadge label="Archived" kind="neutral" />
        ) : (
          <StatusBadge label="Active" kind="success" />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={isTeacher ? 'My Classes' : 'Classes'}
        subtitle={
          isTeacher
            ? 'The sections you teach a subject in. Open one to see its roster and your subjects.'
            : 'Sections (homerooms) across the school. Each section holds one roster and the subjects taught within it.'
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchPlaceholder="Search classes…"
      />

      <DataTable<ClassListItem>
        caption="Classes (sections) list"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(c) => c.id}
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
        sortField="name"
        sortDirection="asc"
        emptyTitle={debouncedSearch ? 'No classes match your search' : 'No classes yet'}
        emptyDescription={
          debouncedSearch ? 'Try a different name.' : 'Sections will appear here once created.'
        }
      />
    </>
  );
}

export default ClassesListPage;
