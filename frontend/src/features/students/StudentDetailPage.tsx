import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  ConfirmDialog,
  DataTable,
  DetailTabs,
  EmptyState,
  ErrorState,
  LoadingState,
  ProfileLayout,
  StatusBadge,
  YearSelect,
  type DataTableColumn,
  type DetailTab,
} from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import {
  useDeleteStudent,
  useSetStudentStatus,
  useStudentAssessments,
  useStudentDetail,
  useStudentYears,
  useUpdateStudent,
} from './hooks/useStudents';
import { StudentFormDialog } from './components/StudentFormDialog';
import { StudentProfileSummary } from './components/StudentProfileSummary';
import { StudentEnrollmentPanel } from './components/StudentEnrollmentPanel';
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
 *  - Enrollment: current section, grade level, and enrollment date.
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

  // Per-student year filter (local to this page): the dropdown lists only the years this
  // student was enrolled in; the choice persists to `?year=` and re-scopes the profile card,
  // Enrollment, and Grades & Assessments together.
  const [searchParams, setSearchParams] = useSearchParams();
  const yearsQuery = useStudentYears(studentId);
  const years = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  const activeYearId = years.find((y) => y.status === 'active')?.id;
  const urlYear = searchParams.get('year') ?? undefined;
  const yearId = years.some((y) => y.id === urlYear) ? urlYear : (activeYearId ?? years[0]?.id);
  const yearName = years.find((y) => y.id === yearId)?.name;
  const changeYear = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('year', id);
    setSearchParams(next, { replace: true });
  };

  const detailQuery = useStudentDetail(studentId, yearId);
  const detail = detailQuery.data;

  const tabs = useMemo<DetailTab[]>(() => {
    if (!detail || !studentId) return [];
    return [
      {
        value: 'enrollment',
        label: 'Enrollment',
        icon: <SchoolOutlinedIcon fontSize="small" />,
        render: () => <StudentEnrollmentPanel student={detail} yearName={yearName} />,
      },
      {
        value: 'grades',
        label: 'Grades & Assessments',
        icon: <GradingOutlinedIcon fontSize="small" />,
        render: () => <GradesTab studentId={studentId} yearId={yearId} />,
      },
    ];
  }, [detail, studentId, yearId, yearName]);

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
      summary={<StudentProfileSummary student={detail} />}
    >
      {tabs.length > 0 && <DetailTabs tabs={tabs} aria-label="Student detail sections" />}
    </ProfileLayout>
  );
}

/** "12 (A)" / "Not yet graded" — a subject group's per-term grade as display text. */
function termGradeText(group: StudentAssessmentGroup): string {
  const { numeric, letter } = group.term_grade;
  if (numeric == null) return 'Not yet graded';
  return `${numeric}${letter ? ` (${letter})` : ''}`;
}

/**
 * Grades & Assessments tab — a grid of SUBJECT CARDS (mirrors the Grades module). Clicking a
 * card drills into that subject's assessments (paginated, 10 per page); a back link returns
 * to the grid. Selection is local to the tab.
 */
function GradesTab({ studentId, yearId }: { studentId: string; yearId?: string }) {
  const query = useStudentAssessments(studentId, yearId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selected = groups.find((g) => g.class_subject_id === selectedId) ?? null;
  if (selected) {
    return <SubjectAssessments group={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <Grid container spacing={2}>
      {groups.map((group) => (
        <Grid item xs={12} sm={6} key={group.class_subject_id}>
          <SubjectCard group={group} onOpen={() => setSelectedId(group.class_subject_id)} />
        </Grid>
      ))}
    </Grid>
  );
}

/** One subject as a clickable card: name · term grade · assessment count. */
function SubjectCard({ group, onOpen }: { group: StudentAssessmentGroup; onOpen: () => void }) {
  const name = group.subject?.name ?? 'Unknown subject';
  const count = group.assessments.length;
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea onClick={onOpen} aria-label={`Open ${name} assessments`} sx={{ height: '100%' }}>
        <CardContent>
          <Stack spacing={0.75}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
              {name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Term grade: {termGradeText(group)}
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip
                size="small"
                variant="outlined"
                label={`${count} assessment${count === 1 ? '' : 's'}`}
              />
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

const ASSESSMENT_COLUMNS: DataTableColumn<StudentAssessmentLine>[] = [
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

const ASSESSMENTS_PAGE_SIZE = 10;

/** Drill-down for one subject: back link, term grade, and its assessments (10 per page). */
function SubjectAssessments({
  group,
  onBack,
}: {
  group: StudentAssessmentGroup;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const name = group.subject?.name ?? 'Unknown subject';
  const rows = group.assessments.slice(
    page * ASSESSMENTS_PAGE_SIZE,
    page * ASSESSMENTS_PAGE_SIZE + ASSESSMENTS_PAGE_SIZE,
  );

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1 }}>
        All subjects
      </Button>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 1.5, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Term grade: {termGradeText(group)}
        </Typography>
      </Stack>
      <DataTable<StudentAssessmentLine>
        caption={`Assessments for ${name}`}
        columns={ASSESSMENT_COLUMNS}
        rows={rows}
        getRowId={(a) => a.id}
        page={page}
        pageSize={ASSESSMENTS_PAGE_SIZE}
        total={group.assessments.length}
        rowsPerPageOptions={[ASSESSMENTS_PAGE_SIZE]}
        onPageChange={setPage}
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
