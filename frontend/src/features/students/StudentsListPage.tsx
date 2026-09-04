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
  Tooltip,
  Typography,
} from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PrintIcon from '@mui/icons-material/Print';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
  ALL_YEARS,
  DataTable,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { useDebounce, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';
import { surnameFirst } from '@shared/utils/names';
import { CIVIL_STATUSES, genderLabel } from '@shared/types/enums';
import { useReligions } from '@features/settings/hooks/useReligions';
import { useStudentFilterOptions, useStudentsList } from './hooks/useStudents';
import { useOfferingOptions } from './hooks/useOfferingOptions';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import { StudentListPrintDialog } from './components/StudentListPrintDialog';
import { StudentFiltersDialog } from './components/StudentFiltersDialog';
import {
  EMPTY_STUDENT_FILTERS,
  activeStudentFilterCount,
  type StudentFilterValues,
} from './components/studentFilters';
import { STUDENT_STATUS_KIND, STUDENT_STATUS_LABEL } from './constants';
import type { StudentListItem, StudentsListParams } from './types';

/**
 * Students directory (api-spec §5.3 GET /students). A searchable, filterable, paginated
 * list — rows link to the student detail. Scope is server-enforced: a teacher sees only
 * students in sections they teach; the route is role-guarded upstream (a student uses
 * "My Profile" instead).
 *
 * **D38 — students are no longer CREATED here.** `Add student` goes to Admissions, because
 * acceptance is the single action that creates the profile, the login and the `YYYYMM###`
 * together (decision #5); a second create path would skip all three. The client asked for
 * the button to lead there, and the create dialog was removed rather than merely unlinked.
 *
 * D38 also gave the year filter an **All years** option and added a column for each filter
 * that had none (gender, religion) — filtering by something the table does not show leaves
 * the result impossible to verify.
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

  // Kept: the print dialog and the filter chips still surface transient feedback here.
  const [toast, setToast] = useState<string | null>(null);

  const offeringsQuery = useOfferingOptions();
  // Memoised rather than `?? []` inline: a fresh literal each render would re-run the
  // `filterSummary` memo below on every keystroke, since it reads both lists.
  const offerings = useMemo(() => offeringsQuery.data ?? [], [offeringsQuery.data]);
  // D40 — the Religion filter now leads with the CLIENT-OWNED `religions` table (the
  // same vocabulary the student and application forms write), not the DISTINCT values
  // found in the register as D32 had it. The old behaviour could not answer "show me the
  // Methodist students" with "none" — it simply had no such option to offer, which reads
  // as the filter being broken rather than the answer being zero.
  //
  // The discovered list is still merged in, and that is the part that must not be
  // dropped: `student_profiles.religion` is free text and stays so (D37), so a student
  // imported from the client's previous system holds a religion the table has never
  // carried. Without the merge they would be visible in the table's Religion column and
  // unreachable by the filter beside it.
  const religionsQuery = useReligions();
  const filterOptions = useStudentFilterOptions().data;
  const religionOptions = useMemo(() => {
    const configured = (religionsQuery.data?.items ?? []).map((r) => r.name);
    const seen = new Set(configured.map((n) => n.toLowerCase()));
    const legacy = (filterOptions?.religions ?? []).filter((r) => !seen.has(r.toLowerCase()));
    return [...configured, ...legacy];
  }, [religionsQuery.data, filterOptions?.religions]);
  // Same idea, one list smaller: the four canonical statuses are hardcoded in the dialog,
  // so only what the register holds BEYOND them needs passing down.
  const legacyCivilStatuses = useMemo(() => {
    const known = new Set(CIVIL_STATUSES.map((c) => c.toLowerCase()));
    return (filterOptions?.civil_statuses ?? []).filter((c) => !known.has(c.toLowerCase()));
  }, [filterOptions?.civil_statuses]);
  const programsQuery = useProgramsList({ page_size: 100, is_active: true });
  const programOptions = useMemo(() => programsQuery.data?.items ?? [], [programsQuery.data]);

  // The year filter has its own hook (it is shared with other modules and persists), so
  // the modal edits it through `filters.yearId` and it is reconciled here.
  const effectiveYearId = filters.yearId ?? yearId;
  // D38 — "All years" is the ABSENCE of `academic_year_id`, not a value for it. Sending
  // the sentinel would have the server look for an academic year called "all" and answer
  // with nothing, which looks exactly like a directory that has no students in it.
  const showAllYears = effectiveYearId === ALL_YEARS;

  const params = useMemo<StudentsListParams>(
    () => ({
      search: debouncedSearch || undefined,
      status: filters.status || undefined,
      offering_id: filters.offeringId || undefined,
      // Filters on the student's OWN level, not on anything derived from what they take.
      year_of_study: filters.yearOfStudy || undefined,
      academic_year_id: showAllYears ? undefined : effectiveYearId || undefined,
      gender: filters.gender || undefined,
      religion: filters.religion || undefined,
      civil_status: filters.civilStatus || undefined,
      program_id: filters.programId || undefined,
      page: page + 1, // API is 1-based
      page_size: pageSize,
      sort: sortDirection === 'desc' ? `-${sortField}` : sortField,
    }),
    [
      debouncedSearch,
      filters,
      effectiveYearId,
      showAllYears,
      page,
      pageSize,
      sortField,
      sortDirection,
    ],
  );

  const query = useStudentsList(params);
  const goToStudent = (id: string) => navigate(`${ROUTES.students}/${id}`);

  const applyFilters = useCallback(
    (next: StudentFilterValues) => {
      setFilters(next);
      // `useYearFilter` owns the persisted year, so a change made in the modal has to be
      // pushed back into it or the two disagree the next time the page mounts.
      //
      // `ALL_YEARS` is deliberately NOT pushed: the hook is shared with the timetable, the
      // grade sheets and the offerings list, and none of those can render "no year". It
      // stays local to this directory, so the other modules keep their real year.
      if (next.yearId && next.yearId !== ALL_YEARS && next.yearId !== yearId) {
        setYearId(next.yearId);
      }
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
        label: showAllYears ? 'All years' : y ? `Year ${y.name}` : 'Academic year',
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
    if (filters.civilStatus) {
      out.push({
        key: 'civilStatus',
        label: filters.civilStatus,
        clear: drop('civilStatus', ''),
      });
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
    showAllYears,
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
    /* D38 — a column for each of the remaining filters (client ask). Filtering by
       something the table does not show leaves the result unverifiable: narrow to Female
       and every row looks identical to an unfiltered list. `Year`, `Programme` and
       `Status` already had columns; these two did not.

       `genderLabel` rather than the raw value: the column is free text for rows this
       system did not write, so 'Male'/'M'/'MALE' all still occur (D37). */
    {
      field: 'gender',
      headerName: 'Gender',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{genderLabel(s.gender) || '—'}</Typography>,
    },
    {
      field: 'religion',
      headerName: 'Religion',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.religion || '—'}</Typography>,
    },
    {
      // D40 — added with the filter, under D38's rule above: a directory narrowed to
      // "Married" that never prints a civil status is a result the Registrar cannot
      // check. Shown as stored, not re-labelled — a legacy value is a real value.
      field: 'civil_status',
      headerName: 'Civil status',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.civil_status || '—'}</Typography>,
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
            /* D38 — this goes to ADMISSIONS instead of opening the create dialog (client
               ask). A student is not typed into existence here: acceptance is the single
               action that creates the profile, the login and the `YYYYMM###` together
               (decision #5), so the honest starting point is the application. */
            <Tooltip title="Students are created by accepting an application">
              <Button
                variant="contained"
                startIcon={<PersonAddAlt1Icon />}
                onClick={() => navigate(ROUTES.applications)}
              >
                Add student
              </Button>
            </Tooltip>
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
        legacyCivilStatuses={legacyCivilStatuses}
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

      {/* D38 — the create dialog is GONE from this page, not merely unlinked. `Add student`
          now goes to Admissions, so nothing could open it, and a dialog nothing can open is
          a second way to create a student that quietly skips acceptance. `StudentFormDialog`
          itself is unchanged and still serves editing from the detail page. */}

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
