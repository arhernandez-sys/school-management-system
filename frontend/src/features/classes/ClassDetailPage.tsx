import { useMemo } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Box, Breadcrumbs, Link as MuiLink, Stack, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import {
  DetailTabs,
  LoadingState,
  ErrorState,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  type DetailTab,
} from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';
import { useClassDetail, useClassSubjects, useClassRoster } from './hooks/useClasses';
import { RosterTab } from './components/RosterTab';
import { SubjectsTab } from './components/SubjectsTab';

/**
 * Class (Section) detail (ui-design-system §7.5, api-spec §5 GET /classes/{id}). A D23
 * homeroom: one roster, many subjects. Header shows name · grade · academic year and a
 * capacity summary with a warn-only "Over capacity" chip (D-Q6). DetailTabs:
 *  - Roster: the section's enrolled students (P/S can enroll/withdraw).
 *  - Subjects: each `class_subject` offering (subject + teacher(s)), linking to its gradebook
 *    (P/S can staff each offering — teachers attach to the offering, not to the section).
 *  - Overview: at-a-glance section stats.
 *
 * Write capability (enroll/withdraw, assign teachers) is UX-gated by the `classes`
 * permission; the server remains authoritative.
 */
export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'classes') : false;

  const detailQuery = useClassDetail(classId);
  const detail = detailQuery.data;

  const tabs = useMemo<DetailTab[]>(() => {
    if (!classId || !detail) return [];
    return [
      {
        value: 'roster',
        label: 'Roster',
        render: () => (
          <RosterTab classId={classId} className={detail.name} canManage={canManage} />
        ),
      },
      {
        value: 'subjects',
        label: 'Subjects',
        render: () => <SubjectsTab classId={classId} canManage={canManage} />,
      },
      {
        value: 'overview',
        label: 'Overview',
        render: () => <OverviewTab classId={classId} />,
      },
    ];
  }, [classId, detail, canManage]);

  if (detailQuery.isLoading) {
    return <LoadingState variant="page" label="Loading class" />;
  }

  if (detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }

  if (!detail) {
    return (
      <EmptyState
        variant="page"
        title="Class not found"
        description="This section may have been removed or you may not have access to it."
        action={{ label: 'Back to classes', onClick: () => navigate(ROUTES.classes) }}
      />
    );
  }

  const capacityText =
    detail.capacity > 0
      ? `${detail.enrolled_count}/${detail.capacity} students`
      : `${detail.enrolled_count} students`;

  return (
    <Box>
      <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 1 }}>
        <MuiLink component={RouterLink} to={ROUTES.classes} underline="hover" color="inherit">
          Classes
        </MuiLink>
        <Typography color="text.primary">{detail.name}</Typography>
      </Breadcrumbs>

      <PageHeader
        title={detail.name}
        subtitle={`${detail.grade_level} · ${detail.academic_year.name}`}
      />

      <Stack direction="row" spacing={1.5} sx={{ mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          Homeroom · {capacityText}
        </Typography>
        {detail.over_capacity && <StatusBadge label="Over capacity" kind="warning" />}
        {detail.is_archived && <StatusBadge label="Archived" kind="neutral" />}
      </Stack>

      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Class detail sections" />}
    </Box>
  );
}

/** Overview tab — reconciled at-a-glance section stats (reads the same endpoints). */
function OverviewTab({ classId }: { classId: string }) {
  const detailQuery = useClassDetail(classId);
  const subjectsQuery = useClassSubjects(classId);
  const rosterQuery = useClassRoster(classId);

  const detail = detailQuery.data;
  const activeSubjects = (subjectsQuery.data ?? []).filter((s) => s.is_active).length;
  const unstaffed = (subjectsQuery.data ?? []).filter(
    (s) => s.is_active && s.teachers.length === 0,
  ).length;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
      }}
    >
      <StatCard
        label="Enrolled students"
        value={rosterQuery.data?.length ?? detail?.enrolled_count ?? 0}
        loading={rosterQuery.isLoading && detailQuery.isLoading}
        icon={<GroupsIcon />}
        color="primary"
        helperText={detail && detail.capacity > 0 ? `Capacity ${detail.capacity}` : undefined}
      />
      <StatCard
        label="Subjects offered"
        value={activeSubjects}
        loading={subjectsQuery.isLoading}
        icon={<MenuBookIcon />}
        color="info"
        helperText={unstaffed > 0 ? `${unstaffed} need a teacher` : 'All staffed'}
      />
      <StatCard
        label="Capacity used"
        value={
          detail && detail.capacity > 0
            ? `${Math.round((detail.enrolled_count / detail.capacity) * 100)}%`
            : '—'
        }
        loading={detailQuery.isLoading}
        icon={<EventAvailableIcon />}
        color={detail?.over_capacity ? 'warning' : 'success'}
        helperText={detail?.over_capacity ? 'Over capacity (warn-only)' : undefined}
      />
    </Box>
  );
}

export default ClassDetailPage;
