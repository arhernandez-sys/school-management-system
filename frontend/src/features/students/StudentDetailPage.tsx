import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Link as MuiLink,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import GradingOutlinedIcon from '@mui/icons-material/GradingOutlined';
import {
  ConfirmDialog,
  DataTable,
  DetailTabs,
  EmptyState,
  ErrorState,
  LoadingState,
  ProfileLayout,
  ProfileSectionHeading,
  StatusBadge,
  type DataTableColumn,
  type DetailTab,
} from '@shared/components';
import type { ReactNode } from 'react';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import {
  useDeleteStudent,
  useSetStudentStatus,
  useStudentAssessments,
  useStudentDetail,
  useUpdateStudent,
} from './hooks/useStudents';
import { StudentFormDialog } from './components/StudentFormDialog';
import { StudentProfileSummary } from './components/StudentProfileSummary';
import {
  STUDENT_STATUS_LABEL as STATUS_LABEL,
  STUDENT_STATUS_OPTIONS as STATUS_OPTIONS,
} from './constants';
import type {
  StudentAssessmentGroup,
  StudentAssessmentLine,
  StudentDetail,
  StudentWritePayload,
} from './types';
import type { StudentStatus } from '@shared/types/enums';

/**
 * Student detail (api-spec §5.3 GET /students/{id}). Header shows name · student # ·
 * status; DetailTabs:
 *  - Profile: bio + guardian + contact.
 *  - Enrollment: current section (and enrollment date).
 *  - Grades & Assessments: subject-grouped assessments with the student's score +
 *    per-subject term grade (compute-on-read).
 *
 * Principal / secretary can edit, change status (422 invalid_transition surfaced), and
 * delete (409 has_academic_history surfaced). Scope is server-enforced.
 */
export function StudentDetailPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'students') : false;

  const detailQuery = useStudentDetail(studentId);
  const detail = detailQuery.data;

  const tabs = useMemo<DetailTab[]>(() => {
    if (!detail || !studentId) return [];
    return [
      {
        value: 'enrollment',
        label: 'Enrollment',
        icon: <SchoolOutlinedIcon fontSize="small" />,
        render: () => <EnrollmentTab student={detail} />,
      },
      {
        value: 'grades',
        label: 'Grades & Assessments',
        icon: <GradingOutlinedIcon fontSize="small" />,
        render: () => <GradesTab studentId={studentId} />,
      },
    ];
  }, [detail, studentId]);

  if (detailQuery.isLoading) {
    return <LoadingState variant="page" label="Loading student" />;
  }
  if (detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (!detail) {
    return (
      <EmptyState
        variant="page"
        title="Student not found"
        description="This student may have been removed or you may not have access."
        action={{ label: 'Back to students', onClick: () => navigate(ROUTES.students) }}
      />
    );
  }

  const breadcrumbs = (
    <Breadcrumbs aria-label="Breadcrumb">
      <MuiLink component={RouterLink} to={ROUTES.students} underline="hover" color="inherit">
        Students
      </MuiLink>
      <Typography color="text.primary" variant="body2">
        {detail.full_name}
      </Typography>
    </Breadcrumbs>
  );

  return (
    <ProfileLayout
      title={detail.full_name}
      breadcrumbs={breadcrumbs}
      actions={canManage ? <StudentActions student={detail} /> : undefined}
      summary={<StudentProfileSummary student={detail} />}
    >
      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Student detail sections" />}
    </ProfileLayout>
  );
}

/** Definition-list layout shared by the Profile + Enrollment tabs. */
function DefinitionList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' },
        rowGap: 1.5,
        columnGap: 3,
        m: 0,
      }}
    >
      {rows.map((r) => (
        <Box key={r.label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {r.label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {r.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** An iconed heading + definition-list grid — one labeled block of a detail tab. */
function Section({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <Box>
      <Box sx={{ mb: 1.5 }}>
        <ProfileSectionHeading icon={icon}>{title}</ProfileSectionHeading>
      </Box>
      <DefinitionList rows={rows} />
    </Box>
  );
}

/** Enrollment tab — current section + enrollment date. */
function EnrollmentTab({ student }: { student: StudentDetail }) {
  if (!student.current_section) {
    return (
      <EmptyState
        variant="card"
        title="Not enrolled"
        description="This student is not currently enrolled in a section."
      />
    );
  }
  return (
    <Section
      icon={<SchoolOutlinedIcon fontSize="small" />}
      title="Enrollment"
      rows={[
        {
          label: 'Current section',
          value: (
            <MuiLink
              component={RouterLink}
              to={`${ROUTES.classes}/${student.current_section.id}`}
              underline="hover"
            >
              {student.current_section.name}
            </MuiLink>
          ),
        },
        { label: 'Grade level', value: student.current_section.grade_level },
        { label: 'Enrolled since', value: student.enrollment_date || '—' },
      ]}
    />
  );
}

/** Grades & Assessments tab — subject-grouped assessments + per-subject term grade. */
function GradesTab({ studentId }: { studentId: string }) {
  const query = useStudentAssessments(studentId);

  if (query.isLoading) {
    return <LoadingState variant="table" rows={4} label="Loading assessments" />;
  }
  if (query.isError) {
    return <ErrorState onRetry={() => void query.refetch()} />;
  }
  const groups = query.data ?? [];
  if (groups.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No assessments yet"
        description="Published assessments for this student's section will appear here."
      />
    );
  }

  return (
    <Stack spacing={3}>
      {groups.map((group) => (
        <SubjectGroup key={group.class_subject_id} group={group} />
      ))}
    </Stack>
  );
}

function SubjectGroup({ group }: { group: StudentAssessmentGroup }) {
  const columns: DataTableColumn<StudentAssessmentLine>[] = [
    {
      field: 'title',
      headerName: 'Assessment',
      primary: true,
      render: (a) => <Typography variant="body2">{a.title}</Typography>,
    },
    {
      field: 'type',
      headerName: 'Type',
      render: (a) => (
        <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
          {a.type}
        </Typography>
      ),
    },
    {
      field: 'assessment_date',
      headerName: 'Date',
      render: (a) => <Typography variant="body2">{a.assessment_date ?? '—'}</Typography>,
    },
    {
      field: 'score',
      headerName: 'Score',
      align: 'right',
      render: (a) => (
        <Typography variant="body2">
          {a.score != null ? `${a.score} / ${a.max_score}` : '—'}
        </Typography>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      render: (a) => {
        const released = a.is_released;
        if (a.status === 'graded' && released) return <StatusBadge label="Graded" kind="success" />;
        if (a.status === 'absent') return <StatusBadge label="Absent" kind="warning" />;
        if (a.status === 'excused' || a.status === 'exempt')
          return <StatusBadge label="Excused" kind="info" />;
        return <StatusBadge label="Pending" kind="neutral" />;
      },
    },
  ];

  const termText =
    group.term_grade.numeric != null
      ? `${group.term_grade.numeric}${group.term_grade.letter ? ` (${group.term_grade.letter})` : ''}`
      : 'Not yet graded';

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 1, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {group.subject?.name ?? 'Unknown subject'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Term grade: {termText}
        </Typography>
      </Stack>
      <DataTable<StudentAssessmentLine>
        caption={`Assessments for ${group.subject?.name ?? 'subject'}`}
        columns={columns}
        rows={group.assessments}
        getRowId={(a) => a.id}
        page={0}
        pageSize={100}
        total={group.assessments.length}
        rowsPerPageOptions={[100]}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle="No assessments"
        emptyDescription="No published assessments in this subject yet."
      />
    </Box>
  );
}

/** Header actions: edit, status change, delete — all principal/secretary only. */
function StudentActions({ student }: { student: StudentDetail }) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]> | undefined>(
    undefined,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<StudentStatus>('active');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const updateMut = useUpdateStudent(student.id);
  const statusMut = useSetStudentStatus(student.id);
  const deleteMut = useDeleteStudent();

  const handleEdit = (values: StudentWritePayload) => {
    setEditError(null);
    setEditFieldErrors(undefined);
    // Section + student_number are immutable on edit; send only benign profile fields.
    const { student_number: _sn, section_id: _sid, ...patch } = values;
    void _sn;
    void _sid;
    updateMut.mutate(patch, {
      onSuccess: () => {
        setEditOpen(false);
        setToast('Student updated.');
      },
      onError: (err) => {
        setEditError(apiErrorMessage(err));
        setEditFieldErrors(fieldErrorsFrom(err));
      },
    });
  };

  const handleStatus = () => {
    setStatusError(null);
    statusMut.mutate(nextStatus, {
      onSuccess: () => {
        setStatusOpen(false);
        setToast(`Status changed to ${STATUS_LABEL[nextStatus]}.`);
      },
      onError: (err) => setStatusError(apiErrorMessage(err)),
    });
  };

  const handleDelete = () => {
    setDeleteError(null);
    deleteMut.mutate(student.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        navigate(ROUTES.students);
      },
      onError: (err) => setDeleteError(apiErrorMessage(err)),
    });
  };

  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        <Button
          variant="outlined"
          onClick={() => {
            setStatusError(null);
            setNextStatus(student.status === 'active' ? 'inactive' : 'active');
            setStatusOpen(true);
          }}
        >
          Change status
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          Delete
        </Button>
      </Stack>

      <StudentFormDialog
        open={editOpen}
        student={student}
        submitting={updateMut.isPending}
        error={editError}
        fieldErrors={editFieldErrors}
        onSubmit={handleEdit}
        onClose={() => setEditOpen(false)}
      />

      <ConfirmDialog
        open={statusOpen}
        title="Change student status"
        description={
          <Box sx={{ mt: 1 }}>
            <TextField
              select
              label="New status"
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as StudentStatus)}
              fullWidth
              size="small"
            >
              {STATUS_OPTIONS.filter((st) => st !== student.status).map((st) => (
                <MenuItem key={st} value={st}>
                  {STATUS_LABEL[st]}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        }
        confirmLabel="Apply"
        pending={statusMut.isPending}
        error={statusError}
        onConfirm={handleStatus}
        onCancel={() => setStatusOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete student?"
        destructive
        description={`Permanently delete ${student.full_name}? Students with grades or attendance on record cannot be deleted — set their status to withdrawn or transferred instead.`}
        confirmLabel="Delete"
        pending={deleteMut.isPending}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />

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

export default StudentDetailPage;
