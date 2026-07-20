import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Link as MuiLink,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import GradingOutlinedIcon from '@mui/icons-material/GradingOutlined';
import {
  ConfirmDialog,
  DetailTabs,
  EmptyState,
  ErrorState,
  LoadingState,
  ProfileLayout,
  StatusBadge,
  type DetailTab,
} from '@shared/components';
import type { ReactNode } from 'react';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ApiError } from '@shared/api/client';
import { ROUTES } from '@shared/constants/routes';
import {
  useDeleteTeacher,
  useSetTeacherStatus,
  useTeacherDetail,
  useUpdateTeacher,
} from '../hooks/useTeachers';
import { TeacherFormDialog, type TeacherFormValues } from './TeacherFormDialog';
import { TeacherProfileSummary } from './TeacherProfileSummary';
import type { TeacherClassTaught, TeacherDetail } from '../types';

/**
 * How the profile is being viewed — resolved by each mount point (the teachers-module
 * gate, {@link TeacherProfileRoute}, or the role-aware `/me`) and used to shape the
 * header actions:
 *  - `manage`   — principal/secretary: full {@link TeacherActions} (edit + activate + delete).
 *  - `self`     — a teacher viewing their OWN profile: a single "Edit profile" affordance.
 *  - `readonly` — a student viewing a subject teacher: no actions.
 *
 * ⚠️ The mode is a UX concern only. Ownership and subject-scoping are re-checked by the
 * server on every /teachers/{id} call (NFR-SEC-01); this never gates data access.
 */
export type TeacherProfileMode = 'manage' | 'self' | 'readonly';

export interface TeacherProfileViewProps {
  /** Teacher id to render (undefined while a caller resolves it — shows loading/empty). */
  teacherId: string | undefined;
  mode: TeacherProfileMode;
}

/**
 * Reusable teacher profile (api-spec §5.4 GET /teachers/{id}). A two-column
 * {@link ProfileLayout}:
 *  - Left: {@link TeacherProfileSummary} identity card (avatar, status, personal info,
 *    statistics, subject-expertise bars).
 *  - Right: {@link DetailTabs}:
 *      · Classes & Subjects — the teacher's class_subjects ("section · subject", lead
 *        chip), each linking to the gradebook (Grades filtered by class_subject_id).
 *      · Grades — the same subjects rendered as clickable rows that open each
 *        class_subject's gradebook.
 *
 * The same component powers all three mount points; `mode` only controls the header
 * actions and breadcrumbs. Directory breadcrumbs render only for `manage` (self/readonly
 * viewers have no teachers directory to return to).
 */
export function TeacherProfileView({ teacherId, mode }: TeacherProfileViewProps) {
  const navigate = useNavigate();

  const detailQuery = useTeacherDetail(teacherId);
  const detail = detailQuery.data;

  const tabs = useMemo<DetailTab[]>(() => {
    if (!detail) return [];
    return [
      {
        value: 'assignments',
        label: `Classes & Subjects (${detail.classes_taught.length})`,
        icon: <MenuBookOutlinedIcon fontSize="small" />,
        render: () => <AssignmentsTab classes={detail.classes_taught} />,
      },
      {
        value: 'grades',
        label: 'Grades',
        icon: <GradingOutlinedIcon fontSize="small" />,
        render: () => <GradesTab classes={detail.classes_taught} />,
      },
    ];
  }, [detail]);

  if (detailQuery.isLoading) {
    return <LoadingState variant="page" label="Loading teacher" />;
  }
  if (detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (!detail) {
    return (
      <EmptyState
        variant="page"
        title="Teacher not found"
        description="This teacher may have been removed or you may not have access."
        action={
          mode === 'manage'
            ? { label: 'Back to teachers', onClick: () => navigate(ROUTES.teachers) }
            : undefined
        }
      />
    );
  }

  const breadcrumbs =
    mode === 'manage' ? (
      <Breadcrumbs aria-label="Breadcrumb">
        <MuiLink component={RouterLink} to={ROUTES.teachers} underline="hover" color="inherit">
          Professors
        </MuiLink>
        <Typography color="text.primary" variant="body2">
          {detail.full_name}
        </Typography>
      </Breadcrumbs>
    ) : undefined;

  let actions: ReactNode;
  if (mode === 'manage') {
    actions = <TeacherActions teacher={detail} variant="manage" />;
  } else if (mode === 'self') {
    actions = <TeacherActions teacher={detail} variant="self" />;
  }

  return (
    <ProfileLayout
      title={detail.full_name}
      breadcrumbs={breadcrumbs}
      actions={actions}
      summary={<TeacherProfileSummary teacher={detail} />}
    >
      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Teacher detail sections" />}
    </ProfileLayout>
  );
}

/** Assignments tab — the teacher's class_subjects, linking toward the gradebook. */
function AssignmentsTab({ classes }: { classes: TeacherClassTaught[] }) {
  if (classes.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No assignments"
        description="This teacher is not assigned to any classes yet."
      />
    );
  }
  return (
    <List disablePadding>
      {classes.map((c) => {
        const sectionName = c.class_ref?.name ?? 'Unknown section';
        const subjectName = c.subject?.name ?? 'Unknown subject';
        return (
          <ListItem
            key={c.class_subject_id}
            divider
            secondaryAction={
              <MuiLink
                component={RouterLink}
                to={`${ROUTES.grades}?class_subject_id=${c.class_subject_id}`}
                underline="hover"
              >
                Gradebook
              </MuiLink>
            }
          >
            <ListItemText
              primary={
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {sectionName} · {subjectName}
                  </Typography>
                  {c.is_lead && <Chip label="Lead" size="small" color="primary" />}
                  {!c.is_active && <StatusBadge label="Inactive" kind="neutral" />}
                </Stack>
              }
              secondary={c.class_ref?.grade_level ?? undefined}
            />
          </ListItem>
        );
      })}
    </List>
  );
}

/** Grades tab — the teacher's subjects as clickable rows, each opening its gradebook. */
function GradesTab({ classes }: { classes: TeacherClassTaught[] }) {
  if (classes.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No subjects to grade"
        description="This teacher is not assigned to any classes yet."
      />
    );
  }
  return (
    <List disablePadding>
      {classes.map((c) => {
        const sectionName = c.class_ref?.name ?? 'Unknown section';
        const subjectName = c.subject?.name ?? 'Unknown subject';
        return (
          <ListItemButton
            key={c.class_subject_id}
            component={RouterLink}
            to={`${ROUTES.grades}?class_subject_id=${c.class_subject_id}`}
            divider
          >
            <ListItemText
              primary={
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {sectionName} · {subjectName}
                  </Typography>
                  {c.is_lead && <Chip label="Lead" size="small" color="primary" />}
                  {!c.is_active && <StatusBadge label="Inactive" kind="neutral" />}
                </Stack>
              }
              secondary={c.class_ref?.grade_level ?? undefined}
            />
            <GradingOutlinedIcon fontSize="small" color="action" />
          </ListItemButton>
        );
      })}
    </List>
  );
}

/**
 * Header actions. Two variants:
 *  - `manage` (principal/secretary) — edit, activate/deactivate, delete.
 *  - `self` (teacher on own profile) — ONLY "Edit profile" (no activate/deactivate/delete;
 *    a teacher must not deactivate or delete their own staff record).
 *
 * The server re-checks authorization on every mutation (NFR-SEC-01); hiding the
 * destructive actions here is UX, not a security control.
 */
function TeacherActions({
  teacher,
  variant = 'manage',
}: {
  teacher: TeacherDetail;
  variant?: 'manage' | 'self';
}) {
  const navigate = useNavigate();
  const isManage = variant === 'manage';
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]> | undefined>(
    undefined,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRefs, setStatusRefs] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteRefs, setDeleteRefs] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const updateMut = useUpdateTeacher(teacher.id);
  const statusMut = useSetTeacherStatus(teacher.id);
  const deleteMut = useDeleteTeacher();

  const nextStatus = teacher.status === 'active' ? 'inactive' : 'active';

  const assignmentRefsFrom = (err: unknown): string[] => {
    const fields = err instanceof ApiError ? err.fields : undefined;
    return fields?.assignments ?? [];
  };

  const handleEdit = (values: TeacherFormValues) => {
    setEditError(null);
    setEditFieldErrors(undefined);
    updateMut.mutate(
      {
        full_name: values.full_name,
        email: values.email || null,
        phone: values.phone || null,
        subject_specializations: values.subject_specializations,
        bio: values.bio || undefined,
        gender: values.gender || undefined,
        education: values.education || undefined,
        designation: values.designation || undefined,
        address: values.address || undefined,
        expertise: values.expertise,
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          setToast(isManage ? 'Teacher updated.' : 'Profile updated.');
        },
        onError: (err) => {
          setEditError(apiErrorMessage(err));
          setEditFieldErrors(fieldErrorsFrom(err));
        },
      },
    );
  };

  const handleStatus = () => {
    setStatusError(null);
    setStatusRefs([]);
    statusMut.mutate(nextStatus, {
      onSuccess: () => {
        setStatusOpen(false);
        setToast(nextStatus === 'active' ? 'Teacher activated.' : 'Teacher deactivated.');
      },
      onError: (err) => {
        setStatusError(apiErrorMessage(err));
        setStatusRefs(assignmentRefsFrom(err));
      },
    });
  };

  const handleDelete = () => {
    setDeleteError(null);
    setDeleteRefs([]);
    deleteMut.mutate(teacher.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        navigate(ROUTES.teachers);
      },
      onError: (err) => {
        setDeleteError(apiErrorMessage(err));
        setDeleteRefs(assignmentRefsFrom(err));
      },
    });
  };

  const refList = (refs: string[]) =>
    refs.length > 0 ? (
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {refs.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </Box>
    ) : undefined;

  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
          {isManage ? 'Edit' : 'Edit profile'}
        </Button>
        {isManage && (
          <>
            <Button
              variant="outlined"
              color={teacher.status === 'active' ? 'warning' : 'success'}
              onClick={() => {
                setStatusError(null);
                setStatusRefs([]);
                setStatusOpen(true);
              }}
            >
              {teacher.status === 'active' ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => {
                setDeleteError(null);
                setDeleteRefs([]);
                setDeleteOpen(true);
              }}
            >
              Delete
            </Button>
          </>
        )}
      </Stack>

      <TeacherFormDialog
        open={editOpen}
        teacher={teacher}
        submitting={updateMut.isPending}
        error={editError}
        fieldErrors={editFieldErrors}
        onSubmit={handleEdit}
        onClose={() => setEditOpen(false)}
      />

      {isManage && (
        <>
          <ConfirmDialog
            open={statusOpen}
            title={teacher.status === 'active' ? 'Deactivate teacher?' : 'Activate teacher?'}
            description={
              teacher.status === 'active'
                ? `Deactivate ${teacher.full_name}? They will no longer appear as active staff.`
                : `Reactivate ${teacher.full_name}?`
            }
            warning={statusRefs.length > 0 ? refList(statusRefs) : undefined}
            confirmLabel={teacher.status === 'active' ? 'Deactivate' : 'Activate'}
            destructive={teacher.status === 'active'}
            pending={statusMut.isPending}
            error={statusError}
            onConfirm={handleStatus}
            onCancel={() => setStatusOpen(false)}
          />

          <ConfirmDialog
            open={deleteOpen}
            title="Delete teacher?"
            destructive
            description={`Permanently delete ${teacher.full_name}? This cannot be undone.`}
            warning={deleteRefs.length > 0 ? refList(deleteRefs) : undefined}
            confirmLabel="Delete"
            pending={deleteMut.isPending}
            error={deleteError}
            onConfirm={handleDelete}
            onCancel={() => setDeleteOpen(false)}
          />
        </>
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

export default TeacherProfileView;
