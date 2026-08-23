import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PrintIcon from '@mui/icons-material/Print';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
  DataTable,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { surnameFirst } from '@shared/utils/names';
import { useCreateStudent, useStudentFilterOptions, useStudentsList } from './hooks/useStudents';
import { useOfferingOptions } from './hooks/useOfferingOptions';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import { StudentFormDialog } from './components/StudentFormDialog';
import { StudentListPrintDialog } from './components/StudentListPrintDialog';
import { StudentFiltersDialog } from './components/StudentFiltersDialog';
import {
  EMPTY_STUDENT_FILTERS,
  activeStudentFilterCount,
  type StudentFilterValues,
} from './components/studentFilters';
import { STUDENT_STATUS_KIND, STUDENT_STATUS_LABEL } from './constants';
import type { StudentListItem, StudentWritePayload, StudentsListParams } from './types';

/**
 * Students directory (api-spec §5.3 GET /students). A searchable, filterable, paginated
 * list — rows link to the student detail. Principal / secretary can add a student.
 * Scope is server-enforced: a teacher sees only students in sections they teach; the
 * route is role-guarded upstream (a student uses "My Profile" instead).
 *
 * **D33 — the filters moved into a modal** (`StudentFiltersDialog`, client ask 1). What is
 * left on the page is the toolbar: search, a badged *Filters* button, and a removable chip
 * per applied filter. The chips are the part that makes the modal safe — a filter you
 * cannot see is a filter you forget you set, and "why is this student missing" is the bug
 * that follows. See the dialog's own note for why the inline row had to go.
 *
 * **Names read `Last, First`** in this table (ask 5) via `surnameFirst`. The SORT key is
 * untouched: it is still the API's `last_name`, which the server expands to
 * `(last_name, first_name, id)`.
 */
export function StudentsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'students') : false;

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  // Everything except search lives in one object so the modal can edit a draft copy of it
  // and commit the lot in a single state update (D33).
  const [filters, setFilters] = useState<StudentFilterValues>(EMPTY_STUDENT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  // D30 §D10: the register is ordered by SURNAME then given name. `last_name` is the
  // API's spelling of that composite ordering — it is not a single-column sort.
  const [sortField, setSortField] = useState('last_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination
  const [pageSize, setPageSize] = useState(25);

  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const offeringsQuery = useOfferingOptions();
  // Memoised rather than `?? []` inline: a fresh literal each render would re-run the
  // `filterSummary` memo below on every keystroke, since it reads both lists.
  const offerings = useMemo(() => offeringsQuery.data ?? [], [offeringsQuery.data]);
  // Religion is free text on the admissions form, so its options are DISCOVERED rather
  // than hardcoded — a fixed list would offer values that match nothing (D32).
  const religionOptions = useStudentFilterOptions().data?.religions ?? [];
  const programsQuery = useProgramsList({ page_size: 100, is_active: true });
  const programOptions = useMemo(() => programsQuery.data?.items ?? [], [programsQuery.data]);

  // The year filter has its own hook (it is shared with other modules and persists), so
  // the modal edits it through `filters.yearId` and it is reconciled here.
  const effectiveYearId = filters.yearId ?? yearId;

  const params = useMemo<StudentsListParams>(
    () => ({
      search: debouncedSearch || undefined,
      status: filters.status || undefined,
      offering_id: filters.offeringId || undefined,
      // Filters on the student's OWN level, not on anything derived from what they take.
      year_of_study: filters.yearOfStudy || undefined,
      academic_year_id: effectiveYearId || undefined,
      gender: filters.gender || undefined,
      religion: filters.religion || undefined,
      program_id: filters.programId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: sortDirection === 'desc' ? `-${sortField}` : sortField,
    }),
    [debouncedSearch, filters, effectiveYearId, page, pageSize, sortField, sortDirection],
  );

  const query = useStudentsList(params);
  const createMut = useCreateStudent();

  const goToStudent = (id: string) => navigate(`${ROUTES.students}/${id}`);

  const handleCreate = (values: StudentWritePayload) => {
    setFormError(null);
    setFieldErrors(undefined);
    createMut.mutate(values, {
      onSuccess: (created) => {
        setCreateOpen(false);
        setToast(`${created.full_name} was added.`);
      },
      onError: (err) => {
        setFormError(apiErrorMessage(err));
        setFieldErrors(fieldErrorsFrom(err));
      },
    });
  };

  const applyFilters = useCallback(
    (next: StudentFilterValues) => {
      setFilters(next);
      // `useYearFilter` owns the persisted year, so a change made in the modal has to be
      // pushed back into it or the two disagree the next time the page mounts.
      if (next.yearId && next.yearId !== yearId) setYearId(next.yearId);
      setPage(0);
      setFiltersOpen(false);
    },
    [setYearId, yearId],
  );

  const filterCount = activeStudentFilterCount(
    { ...filters, yearId: effectiveYearId },
    { activeYearId },
  );
  const hasFilters = Boolean(debouncedSearch) || filterCount > 0;

  /**
   * The applied filters as `{ key, label, clear }` — rendered as removable chips under the
   * toolbar AND (label only) printed on the sheet.
   *
   * A page of names with no heading saying what selected them is indistinguishable from a
   * printout of the whole school, so this is what makes the output a document rather than
   * a list. Built from the same state the query uses, so the two cannot disagree.
   */
  const appliedChips = useMemo(() => {
    const out: Array<{ key: string; label: string; clear: () => void }> = [];
    const drop = <K extends keyof StudentFilterValues>(key: K, empty: StudentFilterValues[K]) =>
      () => {
        setFilters((prev) => ({ ...prev, [key]: empty }));
        setPage(0);
      };

    if (effectiveYearId && effectiveYearId !== activeYearId) {
      const y = years.find((x) => x.id === effectiveYearId);
      out.push({
        key: 'year',
        label: y ? `Year ${y.name}` : 'Academic year',
        clear: () => {
          setFilters((prev) => ({ ...prev, yearId: activeYearId }));
          if (activeYearId) setYearId(activeYearId);
          setPage(0);
        },
      });
    }
    if (filters.status) {
      out.push({
        key: 'status',
        label: STUDENT_STATUS_LABEL[filters.status],
        clear: drop('status', ''),
      });
    }
    if (filters.yearOfStudy) {
      out.push({
        key: 'yearOfStudy',
        label: `Year ${filters.yearOfStudy}`,
        clear: drop('yearOfStudy', ''),
      });
    }
    if (filters.gender) {
      out.push({
        key: 'gender',
        label: filters.gender === 'male' ? 'Male' : 'Female',
        clear: drop('gender', ''),
      });
    }
    if (filters.religion) {
      out.push({ key: 'religion', label: filters.religion, clear: drop('religion', '') });
    }
    if (filters.programId) {
      const p = programOptions.find((o) => o.id === filters.programId);
      out.push({
        key: 'programId',
        label: p ? `${p.code} — ${p.name}` : 'Programme',
        clear: drop('programId', ''),
      });
    }
    if (filters.offeringId) {
      const o = offerings.find((x) => x.id === filters.offeringId);
      out.push({
        key: 'offeringId',
        label: o ? o.label : 'Course offering',
        clear: drop('offeringId', ''),
      });
    }
    return out;
  }, [
    filters,
    effectiveYearId,
    activeYearId,
    years,
    programOptions,
    offerings,
    setYearId,
  ]);

  const filterSummary = useMemo(
    () => [
      ...(debouncedSearch ? [`Search "${debouncedSearch}"`] : []),
      ...appliedChips.map((c) => c.label),
    ],
    [debouncedSearch, appliedChips],
  );

  const clearAll = () => {
    setSearch('');
    setFilters({ ...EMPTY_STUDENT_FILTERS, yearId: activeYearId });
    if (activeYearId) setYearId(activeYearId);
    setPage(0);
  };

  const columns: DataTableColumn<StudentListItem>[] = [
    {
      // Sorting this column asks for `last_name`, which the API expands to
      // (last_name, first_name) — the display string is never the sort key (D30 §D10).
      field: 'last_name',
      headerName: 'Name',
      sortable: true,
      primary: true,
      render: (s) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => goToStudent(s.id)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {/* D33 ask 5 — register order: surname, then given name. */}
          {surnameFirst(s)}
        </MuiLink>
      ),
    },
    {
      field: 'student_number',
      headerName: 'Student #',
      sortable: true,
      render: (s) => <Typography variant="body2">{s.student_number}</Typography>,
    },
    {
      // The student's OWN level (D29 replaced the homeroom name; D30 renamed the field to
      // `year_of_study` and made it an enum). The offerings they take are a variable-length
      // list that belongs on the profile, not in a table cell — the count is what is
      // scannable here, and the course filter above narrows by a specific one.
      field: 'year_of_study',
      headerName: 'Year',
      sortable: true,
      render: (s) => <Typography variant="body2">{s.year_of_study || '—'}</Typography>,
    },
    {
      field: 'program_code',
      headerName: 'Programme',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.program_code || '—'}</Typography>,
    },
    {
      field: 'offering_count',
      headerName: 'Courses',
      align: 'right',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.offering_count}</Typography>,
    },
    {
      field: 'guardian_name',
      headerName: 'Guardian',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.guardian_name || '—'}</Typography>,
    },
    {
      field: 'status',
      headerName: 'Status',
      render: (s) => (
        <StatusBadge label={STUDENT_STATUS_LABEL[s.status]} kind={STUDENT_STATUS_KIND[s.status]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Enrolled students, their programme, and guardian contact."
        secondaryActions={
          /* D32 (brief §3) — prints what is FILTERED, not what is paginated onto the
             screen. See `StudentListPrintDialog` for why that distinction matters. */
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => setPrintOpen(true)}
            disabled={query.isLoading}
          >
            Print list
          </Button>
        }
        primaryAction={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<PersonAddAlt1Icon />}
              onClick={() => {
                setFormError(null);
                setFieldErrors(undefined);
                setCreateOpen(true);
              }}
            >
              Add student
            </Button>
          ) : undefined
        }
      />

      {/* Toolbar. Search + one Filters button — everything else is in the modal. On a
          phone the two stack and both go full width, so neither is a squeezed target. */}
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
              setPage(0);
            }}
            placeholder="Search by name or student #…"
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
                  setPage(0);
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

      <DataTable<StudentListItem>
        caption="Students directory"
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(s) => s.id}
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
        sortField={sortField}
        sortDirection={sortDirection}
        onSortChange={(field, direction) => {
          setSortField(field);
          setSortDirection(direction);
          setPage(0);
        }}
        emptyTitle={hasFilters ? 'No students match your filters' : 'No students yet'}
        emptyDescription={
          hasFilters
            ? 'Try adjusting your search or filters.'
            : 'Students will appear here once added.'
        }
      />

      <StudentFiltersDialog
        open={filtersOpen}
        value={{ ...filters, yearId: effectiveYearId }}
        onApply={applyFilters}
        onClose={() => setFiltersOpen(false)}
        years={years}
        activeYearId={activeYearId}
        yearsLoading={yearsLoading}
        religionOptions={religionOptions}
        programOptions={programOptions}
        offeringOptions={offerings}
        offeringsLoading={offeringsQuery.isLoading}
      />

      <StudentListPrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        params={params}
        filterSummary={filterSummary}
      />

      {canManage && (
        <StudentFormDialog
          open={createOpen}
          submitting={createMut.isPending}
          error={formError}
          fieldErrors={fieldErrors}
          onSubmit={handleCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity="success" onClose={() => setToast(null)} variant="filled">
            {toast}
          </Alert>
        ) : (
          <Box />
        )}
      </Snackbar>
    </>
  );
}

export default StudentsListPage;
