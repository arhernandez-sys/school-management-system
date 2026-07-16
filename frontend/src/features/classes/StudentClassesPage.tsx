import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  type DataTableColumn,
} from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import { useClassesList, useClassSubjects } from './hooks/useClasses';
import type { ClassSubjectItem } from './types';

/**
 * Student "My Classes" (FR-CLS-07). A student lives in ONE self-contained section and
 * simply receives every subject taught in it — they never roam between classrooms. So
 * this screen is NOT the school-wide sections list the admins see; it shows the
 * student's single homeroom and the subjects offered inside it.
 *
 * Scope is server-enforced: `GET /classes` returns only the caller's enrolled section
 * for a student (see mocks/handlers/classes.ts), so we read the first (only) row and
 * render its subjects via GET /classes/{id}/subjects.
 */
export function StudentClassesPage() {
  const sectionQuery = useClassesList({ sort: 'name' });
  const section = sectionQuery.data?.items[0] ?? null;
  const subjectsQuery = useClassSubjects(section?.id);

  if (sectionQuery.isLoading) {
    return <LoadingState variant="page" label="Loading your class" />;
  }
  if (sectionQuery.isError) {
    return <ErrorState onRetry={() => void sectionQuery.refetch()} />;
  }
  if (!section) {
    return (
      <EmptyState
        variant="page"
        title="You're not enrolled in a class yet"
        description="Once the office enrols you in a homeroom, its subjects will appear here."
      />
    );
  }

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
          // Product decision (2026-07): students no longer have access to teacher
          // profiles, so teacher names render as plain text (no link).
          <Typography variant="body2">
            {cs.teachers.map((t) => t.full_name).join(', ')}
          </Typography>
        ) : (
          <StatusBadge label="Not assigned" kind="neutral" />
        ),
    },
    {
      field: 'assessment_count',
      headerName: 'Assessments',
      align: 'right',
      render: (cs) => <Typography variant="body2">{cs.assessment_count}</Typography>,
    },
  ];

  const rowActions = (cs: ClassSubjectItem) => (
    <Button
      component={RouterLink}
      to={`${ROUTES.assessments}?class_subject_id=${cs.class_subject_id}`}
      size="small"
      startIcon={<AssignmentOutlinedIcon fontSize="small" />}
      aria-label={`See assessments for ${cs.subject.name}`}
    >
      Assessments
    </Button>
  );

  const activeSubjects = (subjectsQuery.data ?? []).filter((s) => s.is_active).length;

  return (
    <Box>
      <PageHeader
        title="My Classes"
        subtitle={`You're in ${section.name} — ${section.grade_level}. These are the subjects taught in your homeroom.`}
      />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
        }}
      >
        <StatCard
          label="My homeroom"
          value={section.name}
          icon={<GroupsIcon />}
          color="primary"
          helperText={`${section.enrolled_count} classmates`}
        />
        <StatCard
          label="Subjects I take"
          value={activeSubjects || section.subject_count}
          loading={subjectsQuery.isLoading}
          icon={<MenuBookIcon />}
          color="info"
        />
      </Box>

      <DataTable<ClassSubjectItem>
        caption={`Subjects taught in ${section.name}`}
        columns={columns}
        rows={(subjectsQuery.data ?? []).filter((s) => s.is_active)}
        getRowId={(cs) => cs.class_subject_id}
        isLoading={subjectsQuery.isLoading}
        isError={subjectsQuery.isError}
        onRetry={() => void subjectsQuery.refetch()}
        page={0}
        pageSize={100}
        total={subjectsQuery.data?.length ?? 0}
        rowsPerPageOptions={[100]}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle="No subjects yet"
        emptyDescription="Subjects for your class will appear here once they're set up."
        rowActions={rowActions}
      />
    </Box>
  );
}

export default StudentClassesPage;
