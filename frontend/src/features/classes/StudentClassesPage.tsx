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
import { useSelectedYear } from '@app/providers/YearContext';
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
  const { selectedYearId, selectedPeriod } = useSelectedYear();
  // Sections are YEAR-keyed (`sections.academic_year_id`), so only the year is sent —
  // a semester would narrow nothing here.
  const sectionQuery = useClassesList({ sort: 'name', academic_year_id: selectedYearId });
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

  /**
   * NO `is_active` filter — deliberately, and this is a fix rather than an omission.
   *
   * A past year's `class_subjects` are all INACTIVE by design (that is what closing a
   * year means), so filtering on `is_active` emptied this table for every archived year
   * the switcher can reach: the correct historical section resolved, the header named
   * it, and then the subject list read "No subjects yet". Scope comes from section
   * membership instead — the section is already year-resolved by the query above, so
   * every row belongs to the selected year by construction. `/grades/me` documents and
   * avoids the same trap ("past-year offerings are inactive, so scope by section
   * membership rather than is_active").
   */
  const subjects = subjectsQuery.data ?? [];

  return (
    <Box>
      <PageHeader
        title="My Classes"
        // Tense follows the selected period: present for the active year, past for an
        // archived one. A single hardcoded present tense misdescribed every past year
        // the switcher can reach.
        subtitle={
          selectedPeriod && !selectedPeriod.isActiveYear
            ? `In ${selectedPeriod.yearName} you were in ${section.name} — ${section.grade_level}. These are the subjects that were taught in that homeroom.`
            : `You're in ${section.name} — ${section.grade_level}. These are the subjects taught in your homeroom.`
        }
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
          label={selectedPeriod && !selectedPeriod.isActiveYear ? 'Subjects taken' : 'Subjects I take'}
          value={subjects.length || section.subject_count}
          loading={subjectsQuery.isLoading}
          icon={<MenuBookIcon />}
          color="info"
        />
      </Box>

      <DataTable<ClassSubjectItem>
        caption={`Subjects taught in ${section.name}`}
        columns={columns}
        rows={subjects}
        getRowId={(cs) => cs.class_subject_id}
        isLoading={subjectsQuery.isLoading}
        isError={subjectsQuery.isError}
        onRetry={() => void subjectsQuery.refetch()}
        page={0}
        pageSize={100}
        total={subjects.length}
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
