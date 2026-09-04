import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
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
  YearSelect,
  type DetailTab,
} from '@shared/components';
import type { ReactNode } from 'react';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { ApiError } from '@shared/api/client';
import { ROUTES } from '@shared/constants/routes';
import {
  useDeleteTeacher,
  useSetTeacherStatus,
  useTeacherDetail,
  useTeacherYears,
} from '../hooks/useTeachers';
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
 *      · Classes & Subjects — the teacher's offerings ("label · course", lead chip, term).
 *        Read-only: the gradebook is reached from the Grades tab (D42 §7).
 *      · Grades — the same subjects rendered as clickable rows that open each
 *        class_subject's gradebook.
 *
 * The same component powers all three mount points; `mode` only controls the header
 * actions and breadcrumbs. Directory breadcrumbs render only for `manage` (self/readonly
 * viewers have no teachers directory to return to).
 *
 * **D42 §2 — the academic-year switcher.** Both tabs list what the lecturer teaches, and
 * without a year that was every assignment they had ever held, in one undifferentiated
 * list. The picker sits in the ProfileLayout toolbar and re-scopes both tabs together,
 * exactly as the student profile's does.
 *
 * It is shown to EVERY viewer, `self` included. A Lecturer has the same question about
 * their own record that the Dean has about it, and the switcher cannot widen anything:
 * `classes_taught` is that lecturer's assignments whichever year is selected.
 */
export function TeacherProfileView({ teacherId, mode }: TeacherProfileViewProps) {
  const navigate = useNavigate();

  // Per-lecturer year filter (local to this page): the dropdown lists only the years this
  // lecturer actually taught in, and the choice persists to `?year=` so it survives a
  // refresh or a back-navigation from the gradebook.
  const [searchParams, setSearchParams] = useSearchParams();
  const yearsQuery = useTeacherYears(teacherId);
  const years = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  const activeYearId = years.find((y) => y.status === 'active')?.id;
  const urlYear = searchParams.get('year') ?? undefined;
  const yearId = years.some((y) => y.id === urlYear) ? urlYear : (activeYearId ?? years[0]?.id);
  const changeYear = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('year', id);
    setSearchParams(next, { replace: true });
  };

  // Wait for the years before asking for the detail: see `useTeacherDetail`. A lecturer
  // with NO assignments resolves to an empty list and `yearId === undefined`, which is a
  // legitimate answer — so the gate is "the years have loaded", not "a year was chosen".
  const detailQuery = useTeacherDetail(teacherId, yearId, !yearsQuery.isLoading);
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

  if (yearsQuery.isLoading || detailQuery.isLoading) {
    return <LoadingState variant="page" label="Loading lecturer" />;
  }
  if (detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (!detail) {
    return (
      <EmptyState
        variant="page"
        title="Lecturer not found"
        description="This lecturer may have been removed or you may not have access."
        action={
          mode === 'manage'
            ? { label: 'Back to lecturers', onClick: () => navigate(ROUTES.teachers) }
            : undefined
        }
      />
    );
  }

  const breadcrumbs =
    mode === 'manage' ? (
      <Breadcrumbs aria-label="Breadcrumb">
        <MuiLink component={RouterLink} to={ROUTES.teachers} underline="hover" color="inherit">
          Lecturers
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
      toolbar={
        years.length > 0 ? (
          <YearSelect
            value={yearId}
            onChange={changeYear}
            years={years}
            activeYearId={activeYearId}
            isLoading={yearsQuery.isLoading}
          />
        ) : undefined
      }
      summary={<TeacherProfileSummary teacher={detail} />}
    >
      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Lecturer detail sections" />}
    </ProfileLayout>
  );
}

/** Assignments tab — the teacher's offerings, as a read-only list (D42 §7). */
function AssignmentsTab({ classes }: { classes: TeacherClassTaught[] }) {
  if (classes.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No assignments"
        description="This lecturer has no course offerings in the selected year."
      />
    );
  }
  // D42 §7 — no Gradebook link on these rows. The Grades tab beside this one IS the
  // gradebook view, and two links to the same place from one profile only made the reader
  // wonder how they differed.
  return (
    <List disablePadding>
      {classes.map((c) => (
        <ListItem key={c.offering_id} divider>
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {/* Label + course name. The label (code + section) is what tells one
                      section of a course from another; the pair this replaced was a homeroom
                      name and a subject name — two rows' worth of identity. */}
                  {c.offering.label} · {c.offering.course.name}
                </Typography>
                {c.is_lead && <Chip label="Lead" size="small" color="primary" />}
              </Stack>
            }
            /* The TERM, where this printed the homeroom's Form. It is the fact that
               distinguishes two otherwise identical assignments. */
            secondary={c.offering.semester?.name ?? undefined}
          />
        </ListItem>
      ))}
    </List>
  );
}

/** Grades tab — the teacher's subjects as clickable rows, each opening its gradebook. */
function GradesTab({ classes }: { classes: TeacherClassTaught[] }) {
  if (classes.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No courses to grade"
        description="This lecturer has no course offerings in the selected year."
      />
    );
  }
  return (
    <List disablePadding>
      {classes.map((c) => (
        <ListItemButton
          key={c.offering_id}
          component={RouterLink}
          to={`${ROUTES.grades}?offering_id=${c.offering_id}`}
          divider
        >
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {c.offering.label} · {c.offering.course.name}
                </Typography>
                {c.is_lead && <Chip label="Lead" size="small" color="primary" />}
              </Stack>
            }
            secondary={c.offering.semester?.name ?? undefined}
          />
          <GradingOutlinedIcon fontSize="small" color="action" />
        </ListItemButton>
      ))}
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
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRefs, setStatusRefs] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteRefs, setDeleteRefs] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const statusMut = useSetTeacherStatus(teacher.id);
  const deleteMut = useDeleteTeacher();

  const nextStatus = teacher.status === 'active' ? 'inactive' : 'active';

  const assignmentRefsFrom = (err: unknown): string[] => {
    const fields = err instanceof ApiError ? err.fields : undefined;
    return fields?.assignments ?? [];
  };

  const handleStatus = () => {
    setStatusError(null);
    setStatusRefs([]);
    statusMut.mutate(nextStatus, {
      onSuccess: () => {
        setStatusOpen(false);
        setToast(nextStatus === 'active' ? 'Lecturer activated.' : 'Lecturer deactivated.');
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
        {/* D40 — the edit form is a PAGE now (`/teachers/:id/edit`), not a modal. Create
            and edit are the same screen, which is what stops the two from disagreeing
            about which fields a lecturer record even has — the bug the dialog had, where
            create showed six fields and edit showed twenty. */}
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => navigate(`${ROUTES.teachers}/${teacher.id}/edit`)}
        >
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

      {isManage && (
        <>
          <ConfirmDialog
            open={statusOpen}
            title={teacher.status === 'active' ? 'Deactivate lecturer?' : 'Activate lecturer?'}
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
            title="Delete lecturer?"
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
