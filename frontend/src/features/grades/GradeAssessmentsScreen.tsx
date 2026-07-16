import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Link as MuiLink, Stack, Typography } from '@mui/material';
import {
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusBadge,
  YearSelect,
  type DataTableColumn,
} from '@shared/components';
import { useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import {
  useAssessmentsList,
  type AssessmentListItem,
} from '@features/assessments/hooks/useAssessments';
import { STATUS_META, TYPE_LABEL } from '@features/assessments/statusMeta';
import { ClassSubjectPicker } from './components/ClassSubjectPicker';
import { useClassSubjectOptions } from './hooks/useGrades';

const CLASS_SUBJECT_PARAM = 'class_subject_id';

/**
 * Grades entry point — a LIST of assessments (replaces the old students×assessments
 * grid). Pick a year + class·subject, then click an assessment to grade the whole class
 * on the per-assessment page (`/grades/assessment/:id`). Teacher sees their offerings;
 * P/S see all (read-only downstream). Students use "My Grades" instead.
 */
export function GradeAssessmentsScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';

  const { yearId, setYearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(CLASS_SUBJECT_PARAM);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const optionsQuery = useClassSubjectOptions(yearId);
  const options = useMemo(() => optionsQuery.data?.items ?? [], [optionsQuery.data]);
  const selectedOption = useMemo(
    () => options.find((o) => o.id === selectedId) ?? null,
    [options, selectedId],
  );

  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set(CLASS_SUBJECT_PARAM, id);
    else next.delete(CLASS_SUBJECT_PARAM);
    setSearchParams(next, { replace: true });
    setPage(0);
  };

  // Auto-select the first offering (prefer one the teacher can edit) so the list is
  // useful in one hop. Re-runs when the year changes and the selection is stale.
  useEffect(() => {
    if (options.length === 0) return;
    if (selectedId && options.some((o) => o.id === selectedId)) return;
    const first = options.find((o) => o.can_edit) ?? options[0];
    if (first) {
      const next = new URLSearchParams(searchParams);
      next.set(CLASS_SUBJECT_PARAM, first.id);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, selectedId]);

  const listParams = useMemo(
    () => ({
      class_subject_id: selectedId || undefined,
      academic_year_id: yearId || undefined,
      page: page + 1,
      page_size: pageSize,
      sort: '-assessment_date',
    }),
    [selectedId, yearId, page, pageSize],
  );
  const listQuery = useAssessmentsList(listParams, Boolean(selectedId));

  const openGrading = (a: AssessmentListItem) => {
    const csId = a.class_subject?.class_subject_id ?? selectedId ?? '';
    navigate(`${ROUTES.gradeAssessment}/${a.id}?${CLASS_SUBJECT_PARAM}=${encodeURIComponent(csId)}`);
  };

  const columns: DataTableColumn<AssessmentListItem>[] = [
    {
      field: 'title',
      headerName: 'Assessment',
      primary: true,
      render: (a) => (
        <MuiLink
          component="button"
          type="button"
          onClick={() => openGrading(a)}
          sx={{ fontWeight: 500, textAlign: 'left' }}
        >
          {a.title}
        </MuiLink>
      ),
    },
    { field: 'type', headerName: 'Type', render: (a) => TYPE_LABEL[a.type] },
    {
      field: 'assessment_date',
      headerName: 'Date',
      render: (a) =>
        a.assessment_date ?? (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
    { field: 'max_score', headerName: 'Max', align: 'right', render: (a) => a.max_score },
    {
      field: 'status',
      headerName: 'Status',
      render: (a) => (
        <StatusBadge label={STATUS_META[a.status].label} kind={STATUS_META[a.status].kind} />
      ),
    },
  ];

  const subtitle = isTeacher
    ? 'Pick a class, then open an assessment to grade the whole class at once.'
    : 'Browse assessments by class. Grade entry is done by the subject teacher.';

  return (
    <Box sx={{ pt: 3 }}>
      <PageHeader title="Grades" subtitle={subtitle} />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' } }}
      >
        <YearSelect
          value={yearId}
          onChange={(id) => {
            // A class·subject belongs to one year — clear the stale selection so the
            // auto-select picks a valid offering for the new year.
            setSelected(null);
            setYearId(id);
            setPage(0);
          }}
          years={years}
          activeYearId={activeYearId}
          isLoading={yearsLoading}
        />
        <ClassSubjectPicker
          options={options}
          value={selectedOption}
          onChange={(opt) => setSelected(opt?.id ?? null)}
          loading={optionsQuery.isLoading}
          disabled={optionsQuery.isError}
        />
      </Stack>

      {optionsQuery.isError && (
        <ErrorState
          message="We couldn't load your class subjects."
          onRetry={() => void optionsQuery.refetch()}
        />
      )}

      {!optionsQuery.isLoading && !optionsQuery.isError && options.length === 0 && (
        <EmptyState
          variant="page"
          title="No class subjects"
          description={
            isTeacher
              ? 'You are not assigned to any subjects in this year.'
              : 'No class subjects were found for this year.'
          }
        />
      )}

      {options.length > 0 && !selectedId && (
        <EmptyState
          variant="page"
          title="Choose a class subject"
          description="Select a class · subject above to see its assessments."
        />
      )}

      {selectedId && (
        <>
          {selectedOption && (
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {selectedOption.display_name}
            </Typography>
          )}
          {listQuery.isError ? (
            <Alert severity="error" role="alert">
              Could not load assessments.{' '}
              <Button size="small" onClick={() => void listQuery.refetch()}>
                Retry
              </Button>
            </Alert>
          ) : (
            <DataTable<AssessmentListItem>
              caption="Assessments for the selected class subject"
              columns={columns}
              rows={listQuery.data?.items ?? []}
              getRowId={(a) => a.id}
              isLoading={listQuery.isLoading}
              isError={listQuery.isError}
              onRetry={() => void listQuery.refetch()}
              page={page}
              pageSize={pageSize}
              total={listQuery.data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(ps) => {
                setPageSize(ps);
                setPage(0);
              }}
              emptyTitle="No assessments yet"
              emptyDescription="Assessments for this class subject will appear here. Create them in Assessments."
            />
          )}
        </>
      )}
    </Box>
  );
}

export default GradeAssessmentsScreen;
