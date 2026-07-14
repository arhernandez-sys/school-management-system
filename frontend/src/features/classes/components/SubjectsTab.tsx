import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import { DataTable, StatusBadge, type DataTableColumn } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useClassSubjects } from '../hooks/useClasses';
import type { ClassSubjectItem } from '../types';

/**
 * Class detail → Subjects tab (ui-design-system §7.5). Lists each `class_subject`
 * offering in the section — subject, assigned teacher(s), assessment count — with each
 * row linking toward that offering's gradebook
 * (`/grades?class_subject_id=…`, §7.7). The Subjects tab is the D23 hub from which each
 * subject's gradebook / assessments / teacher(s) are reached.
 *
 * This tab is presentational + read paths only; add/assign management (P/S) is surfaced
 * elsewhere. `assessment_count` and teacher names come straight from the API row.
 */
export interface SubjectsTabProps {
  classId: string;
}

export function SubjectsTab({ classId }: SubjectsTabProps) {
  const query = useClassSubjects(classId);

  const columns: DataTableColumn<ClassSubjectItem>[] = [
    {
      field: 'subject',
      headerName: 'Subject',
      primary: true,
      render: (cs) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {cs.subject.name}
          </Typography>
          {cs.subject.code && (
            <Typography variant="caption" color="text.secondary">
              {cs.subject.code}
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      field: 'teachers',
      headerName: 'Teacher(s)',
      render: (cs) =>
        cs.teachers.length > 0 ? (
          <Typography variant="body2">
            {cs.teachers.map((t) => t.full_name).join(', ')}
          </Typography>
        ) : (
          <StatusBadge label="Needs teacher" kind="warning" />
        ),
    },
    {
      field: 'assessment_count',
      headerName: 'Assessments',
      align: 'right',
      render: (cs) => <Typography variant="body2">{cs.assessment_count}</Typography>,
    },
    {
      field: 'is_active',
      headerName: 'Status',
      render: (cs) =>
        cs.is_active ? (
          <StatusBadge label="Active" kind="success" />
        ) : (
          <StatusBadge label="Retired" kind="neutral" />
        ),
    },
  ];

  const rowActions = (cs: ClassSubjectItem) => (
    <Button
      component={RouterLink}
      to={`${ROUTES.grades}?class_subject_id=${cs.class_subject_id}`}
      size="small"
      startIcon={<AssessmentOutlinedIcon fontSize="small" />}
      aria-label={`Open gradebook for ${cs.subject.name}`}
    >
      Gradebook
    </Button>
  );

  return (
    <DataTable<ClassSubjectItem>
      caption="Subjects taught in this section"
      columns={columns}
      rows={query.data ?? []}
      getRowId={(cs) => cs.class_subject_id}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      // Sub-resource list isn't server-paginated; render it all on one page.
      page={0}
      pageSize={100}
      total={query.data?.length ?? 0}
      rowsPerPageOptions={[100]}
      onPageChange={() => undefined}
      onPageSizeChange={() => undefined}
      emptyTitle="No subjects offered yet"
      emptyDescription="Subjects added to this section will appear here, each with its own gradebook."
      rowActions={rowActions}
    />
  );
}

export default SubjectsTab;
