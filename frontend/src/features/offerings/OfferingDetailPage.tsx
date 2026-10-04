import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Box, Breadcrumbs, Button, Link as MuiLink, Stack, Typography } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import ScheduleIcon from '@mui/icons-material/Schedule';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
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
import { strings } from '@i18n/strings';
import { useOfferingDetail, useOfferingRoster } from './hooks/useOfferings';
import { RosterTab } from './components/RosterTab';
import { ScheduleTab } from './components/ScheduleTab';
import { AssignTeachersDialog } from './components/AssignTeachersDialog';
import { roomsOf, summarizeMeetings } from './meetingFormat';

/**
 * Course-offering detail (ui-design-system §7.5, api-spec §5 GET /offerings/{id}).
 *
 * **D31** — one offering: one course, one semester, one lecturer set, one weekly slot, one
 * roster. Tabs:
 *  - Roster: the students enrolled in THIS offering (P/S enroll/withdraw).
 *  - Schedule: the Mon–Fri meeting rows (P/S edit; others read).
 *  - Overview: at-a-glance stats.
 *
 * The **Subjects tab stays retired**, and the reason got stronger: it existed because a
 * homeroom taught many subjects, each needing its own row to staff and to reach a
 * gradebook. `class_subjects` is gone entirely now, so there is no such row to list. The
 * course and its lecturers live in the header, where "Change lecturers" reaches
 * `PUT /offerings/{id}/teachers` — one id, no homeroom hop.
 *
 * Write capability is UX-gated by the `offerings` permission; the server stays
 * authoritative.
 */
export function OfferingDetailPage() {
  const { offeringId } = useParams<{ offeringId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'offerings') : false;
  const [teachersOpen, setTeachersOpen] = useState(false);

  const detailQuery = useOfferingDetail(offeringId);
  const detail = detailQuery.data;

  const tabs = useMemo<DetailTab[]>(() => {
    if (!offeringId || !detail) return [];
    return [
      {
        value: 'roster',
        label: 'Roster',
        render: () => (
          <RosterTab offeringId={offeringId} offeringLabel={detail.label} canManage={canManage} />
        ),
      },
      {
        value: 'schedule',
        label: 'Schedule',
        render: () => (
          <ScheduleTab offeringId={offeringId} offeringLabel={detail.label} canManage={canManage} />
        ),
      },
      {
        value: 'overview',
        label: 'Overview',
        render: () => <OverviewTab offeringId={offeringId} />,
      },
    ];
  }, [offeringId, detail, canManage]);

  if (detailQuery.isLoading) {
    return <LoadingState variant="page" label="Loading offering" />;
  }

  if (detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }

  if (!detail) {
    return (
      <EmptyState
        variant="page"
        title="Course offering not found"
        description="This offering may have been removed or you may not have access to it."
        action={{ label: 'Back to offerings', onClick: () => navigate(ROUTES.offerings) }}
      />
    );
  }

  const capacity = detail.capacity ?? 0;
  const capacityText =
    capacity > 0
      ? `${detail.enrolled_count}/${capacity} students`
      : `${detail.enrolled_count} students`;
  const teacherText =
    detail.teachers.length > 0
      ? detail.teachers.map((t) => t.full_name).join(', ')
      : 'No lecturer assigned';
  const when = summarizeMeetings(detail.meetings);
  const rooms = roomsOf(detail.meetings);
  // The subtitle answers "which course, which term, which year" — the three facts that
  // distinguish this row from another offering of the same course. Each part is dropped
  // when unresolved rather than printed as an empty segment.
  const subtitle = [
    detail.course ? `${detail.course.name}${detail.course.code ? ` (${detail.course.code})` : ''}` : null,
    detail.semester?.name ?? null,
    detail.academic_year?.name ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box>
      <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 1 }}>
        <MuiLink component={RouterLink} to={ROUTES.offerings} underline="hover" color="inherit">
          {strings.nav.offerings}
        </MuiLink>
        <Typography color="text.primary">{detail.label}</Typography>
      </Breadcrumbs>

      <PageHeader
        title={detail.label}
        subtitle={subtitle || undefined}
        primaryAction={
          canManage ? (
            <Button variant="outlined" onClick={() => setTeachersOpen(true)}>
              Change lecturers
            </Button>
          ) : undefined
        }
      />

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ mb: 3, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {teacherText} · {capacityText}
          {when ? ` · ${when}` : ''}
          {rooms.length > 0 ? ` · ${rooms.join(' · ')}` : ''}
        </Typography>
        {!detail.course && <StatusBadge label="No course" kind="warning" />}
        {!when && <StatusBadge label="Not scheduled" kind="neutral" />}
        {detail.over_capacity && <StatusBadge label="Over capacity" kind="warning" />}
        {detail.is_archived && <StatusBadge label="Archived" kind="neutral" />}
      </Stack>

      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Course offering sections" />}

      {canManage && (
        <AssignTeachersDialog
          open={teachersOpen}
          offering={detail}
          onClose={() => setTeachersOpen(false)}
          onAssigned={() => {
            setTeachersOpen(false);
            void detailQuery.refetch();
          }}
        />
      )}
    </Box>
  );
}

/** Overview tab — at-a-glance stats for one offering. */
function OverviewTab({ offeringId }: { offeringId: string }) {
  const detailQuery = useOfferingDetail(offeringId);
  const rosterQuery = useOfferingRoster(offeringId);

  const detail = detailQuery.data;
  const capacity = detail?.capacity ?? 0;
  const meetingCount = detail?.meetings.length ?? 0;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
      }}
    >
      <StatCard
        label="Enrolled students"
        value={rosterQuery.data?.length ?? detail?.enrolled_count ?? 0}
        loading={rosterQuery.isLoading && detailQuery.isLoading}
        icon={<GroupsIcon />}
        color="primary"
        helperText={capacity > 0 ? `Capacity ${capacity}` : 'No capacity limit'}
      />
      <StatCard
        label={strings.terms.lecturers}
        value={detail?.teachers.length ?? 0}
        loading={detailQuery.isLoading}
        icon={<PersonOutlineIcon />}
        color="info"
        helperText={detail && detail.teachers.length === 0 ? 'Needs a lecturer' : 'Assigned'}
      />
      <StatCard
        label="Meetings / week"
        value={meetingCount}
        loading={detailQuery.isLoading}
        icon={<ScheduleIcon />}
        color={meetingCount === 0 ? 'warning' : 'success'}
        helperText={meetingCount === 0 ? 'Not on any timetable yet' : undefined}
      />
      <StatCard
        label="Capacity used"
        value={
          detail && capacity > 0
            ? `${Math.round((detail.enrolled_count / capacity) * 100)}%`
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

export default OfferingDetailPage;
