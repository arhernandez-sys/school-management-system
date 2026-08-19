import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  Button,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
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
import { useClassDetail, useClassRoster } from './hooks/useClasses';
import { RosterTab } from './components/RosterTab';
import { ScheduleTab } from './components/ScheduleTab';
import { AssignTeachersDialog } from './components/AssignTeachersDialog';
import { roomsOf, summarizeMeetings } from './meetingFormat';

/**
 * Subject-class detail (ui-design-system §7.5, api-spec §5 GET /classes/{id}).
 *
 * **D29** — one class, one subject, one teacher set, one weekly slot, one roster. Tabs:
 *  - Roster: the students enrolled in THIS class (P/S enroll/withdraw).
 *  - Schedule: the Mon–Fri meeting rows (P/S edit; others read).
 *  - Overview: at-a-glance stats.
 *
 * The **Subjects tab is retired**. It existed because a homeroom taught many subjects, each
 * needing its own row to staff and to reach a gradebook. A subject class has exactly one
 * subject — fixed at creation — so that list would always hold a single row. The subject and
 * its teachers moved into the header, where "Change teachers" reaches the same
 * `PUT /classes/{id}/subjects/{cs}/teachers` the tab used.
 *
 * Write capability is UX-gated by the `classes` permission; the server stays authoritative.
 */
export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'classes') : false;
  const [teachersOpen, setTeachersOpen] = useState(false);

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
        value: 'schedule',
        label: 'Schedule',
        render: () => (
          <ScheduleTab classId={classId} className={detail.name} canManage={canManage} />
        ),
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
        title="Course offering not found"
        description="This class may have been removed or you may not have access to it."
        action={{ label: 'Back to classes', onClick: () => navigate(ROUTES.classes) }}
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
      : 'No teacher assigned';
  const when = summarizeMeetings(detail.meetings);
  const rooms = roomsOf(detail.meetings);

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
        subtitle={
          detail.subject
            ? `${detail.subject.name} · ${detail.grade_level} · ${detail.academic_year.name}`
            : `${detail.grade_level} · ${detail.academic_year.name}`
        }
        primaryAction={
          canManage && detail.class_subject_id ? (
            <Button variant="outlined" onClick={() => setTeachersOpen(true)}>
              Change teachers
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
        {!detail.subject && <StatusBadge label="No subject" kind="warning" />}
        {!when && <StatusBadge label="Not scheduled" kind="neutral" />}
        {detail.over_capacity && <StatusBadge label="Over capacity" kind="warning" />}
        {detail.is_archived && <StatusBadge label="Archived" kind="neutral" />}
      </Stack>

      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Course offering sections" />}

      {canManage && detail.class_subject_id && detail.subject && (
        // The dialog's contract is unchanged from when the retired Subjects tab owned it —
        // it only reads class_subject_id / teachers / lead_teacher_id — so the offering is
        // synthesized from the class detail rather than reshaping a careful component.
        // `assessment_count` is not used by it; `actionable_by_caller` is true because the
        // button that opens this is already behind `canManage`.
        <AssignTeachersDialog
          open={teachersOpen}
          classId={detail.id}
          classSubject={{
            class_subject_id: detail.class_subject_id,
            subject: detail.subject,
            teachers: detail.teachers,
            lead_teacher_id: detail.lead_teacher_id,
            assessment_count: 0,
            is_active: true,
            actionable_by_caller: true,
          }}
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

/** Overview tab — at-a-glance stats for one subject class. */
function OverviewTab({ classId }: { classId: string }) {
  const detailQuery = useClassDetail(classId);
  const rosterQuery = useClassRoster(classId);

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
        label="Lecturers"
        value={detail?.teachers.length ?? 0}
        loading={detailQuery.isLoading}
        icon={<PersonOutlineIcon />}
        color="info"
        helperText={
          detail && detail.teachers.length === 0 ? 'Needs a teacher' : 'Assigned'
        }
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

export default ClassDetailPage;
