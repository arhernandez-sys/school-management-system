import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import EventSeatOutlinedIcon from '@mui/icons-material/EventSeatOutlined';
import ScaleOutlinedIcon from '@mui/icons-material/ScaleOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
} from '@shared/components';
import { useAcademicYears } from '@features/settings/hooks/useSettings';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import { TermPicker } from '../components/TermPicker';
import {
  useActiveTerm,
  useCreditLoad,
  useNewVsReturning,
  useOvercapacity,
  useProgrammeAttendance,
} from '../hooks/useReports';
import type {
  CreditLoadReport,
  NewVsReturningReport,
  OvercapacityReport,
  OvercapacityRow,
  ProgrammeAttendanceReport,
  ReportScope,
} from '../types';

/**
 * College reports — the four institutional reports of blueprint §53 (D45 Phase 9).
 *
 * **WHY ONE SCREEN WITH FOUR TABS, NOT FOUR TABS ON THE REPORTS PAGE.** The Reports
 * module's own tab bar carries DOCUMENTS — a report card, a transcript — things printed
 * and handed to a person. These four are management reports about the college, read to
 * find the thing that needs attention. Six top-level tabs mixing the two kinds would
 * have made the bar the widest thing on the page and taught nobody which was which.
 * The inner tabs keep all four visible at once, which is why they are tabs and not the
 * Audit trail's dropdown: there are only four, and a Dean scanning for trouble wants to
 * see that there ARE four.
 *
 * **THE `note` IS RENDERED ON EVERY ONE OF THEM, DELIBERATELY.** The server sends a
 * plain sentence saying what the numbers mean and what they do not, and this screen is
 * the only place the reader will ever see it. A management report whose definition lives
 * in a service docstring is a report two people read two different ways in the same
 * meeting. It is styled as information, not as a warning: it is not an error, it is the
 * legend.
 *
 * **SCOPE.** A Head of Department is narrowed to their own programmes by the server, and
 * `ScopeNotice` says so above the numbers. An HOD reading "3 classes over capacity" must
 * not carry it out of the room as the college total.
 *
 * Terminology: SESSION, never "term" or "semester" (D45 Meeting #5 / Phase 3A). The
 * wire field is still `semester_id`; only the words the reader sees changed.
 */
type ReportKey = 'intake' | 'capacity' | 'load' | 'attendance';

const TABS: { key: ReportKey; label: string }[] = [
  { key: 'intake', label: 'New vs returning' },
  { key: 'capacity', label: 'Over capacity' },
  { key: 'load', label: 'Credit load' },
  { key: 'attendance', label: 'Attendance by programme' },
];

/** The server's definition of the numbers above. Information, not a warning. */
function ReportNote({ note }: { note: string }) {
  return (
    <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
      <Typography variant="body2">{note}</Typography>
    </Alert>
  );
}

function ScopeNotice({ scope }: { scope: ReportScope }) {
  if (!scope.is_scoped) return null;
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {scope.programmes.length === 0 ? (
        <>
          You head no programme yet, so this report is empty. It is not that the college
          has no data — it is that nothing has been assigned to you.
        </>
      ) : (
        <>
          These figures cover <strong>{scope.programmes.join(', ')}</strong> only, not the
          whole college.
        </>
      )}
    </Alert>
  );
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// ══════════════════════════════════════════════════════════════════════════════
// New versus returning (§53 Enrollment)
// ══════════════════════════════════════════════════════════════════════════════
function IntakePanel({ report }: { report: NewVsReturningReport }) {
  return (
    <>
      <ScopeNotice scope={report.scope} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <StatCard
          label="New students"
          value={report.new}
          icon={<GroupAddOutlinedIcon />}
          color="success"
        />
        <StatCard label="Returning students" value={report.returning} color="info" />
        <StatCard label="Registered in the year" value={report.total} color="primary" />
      </Stack>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        By programme
      </Typography>
      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Programme</TableCell>
              <TableCell align="right">New</TableCell>
              <TableCell align="right">Returning</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {report.by_programme.map((row) => (
              <TableRow key={row.programme}>
                <TableCell>{row.programme}</TableCell>
                <TableCell align="right">{row.new}</TableCell>
                <TableCell align="right">{row.returning}</TableCell>
                <TableCell align="right">{row.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        By session
      </Typography>
      {/* The two readings genuinely differ — see `NewVsReturningSemesterRow`. Saying so
          here is what stops somebody "reconciling" them. */}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        Here "new" means the student had never registered in any session before this one —
        so a student who started in the first session counts as returning in the second, of
        the same year.
      </Typography>
      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Session</TableCell>
              <TableCell align="right">First-ever session</TableCell>
              <TableCell align="right">Continuing</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {report.by_semester.map((row) => (
              <TableRow key={row.semester.id}>
                <TableCell>{row.semester.name}</TableCell>
                <TableCell align="right">{row.new}</TableCell>
                <TableCell align="right">{row.returning}</TableCell>
                <TableCell align="right">{row.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Students ({report.students.length})
      </Typography>
      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Student</TableCell>
              <TableCell>Number</TableCell>
              <TableCell>Programme</TableCell>
              <TableCell>Standing</TableCell>
              <TableCell>First registered</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {report.students.map((row) => (
              <TableRow key={row.student.id}>
                <TableCell>{row.student.full_name}</TableCell>
                <TableCell>{row.student.student_number}</TableCell>
                <TableCell>{row.programme ?? '—'}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={row.is_new ? 'New' : 'Returning'}
                    color={row.is_new ? 'success' : 'default'}
                    variant={row.is_new ? 'filled' : 'outlined'}
                  />
                </TableCell>
                {/* The evidence, not just the verdict — a Registrar challenged on this
                    number has to be able to point at the year. */}
                <TableCell>{row.first_registered_year ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ReportNote note={report.note} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Over capacity (§53 Registration)
// ══════════════════════════════════════════════════════════════════════════════
function CapacityTable({ rows, showOverBy }: { rows: OvercapacityRow[]; showOverBy: boolean }) {
  return (
    <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 3 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Class</TableCell>
            <TableCell>Course</TableCell>
            <TableCell>Lecturer</TableCell>
            <TableCell align="right">Seats</TableCell>
            <TableCell align="right">Registered</TableCell>
            {showOverBy && <TableCell align="right">Over by</TableCell>}
            <TableCell align="right">Used</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.offering.id}>
              <TableCell>{row.offering.label}</TableCell>
              <TableCell>{row.offering.course.name}</TableCell>
              <TableCell>{row.lecturer ?? 'Not assigned'}</TableCell>
              {/* A dash, never a 0: "no capacity recorded" and "no seats" are different
                  facts and only one of them is a problem. */}
              <TableCell align="right">{row.capacity ?? '—'}</TableCell>
              <TableCell align="right">{row.registered}</TableCell>
              {showOverBy && (
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  {row.over_by}
                </TableCell>
              )}
              <TableCell align="right">{pct(row.utilisation_pct)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CapacityPanel({ report }: { report: OvercapacityReport }) {
  return (
    <>
      <ScopeNotice scope={report.scope} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <StatCard
          label="Over capacity"
          value={report.over.length}
          icon={<EventSeatOutlinedIcon />}
          color={report.over.length > 0 ? 'error' : 'success'}
        />
        <StatCard label="Exactly full" value={report.at_capacity.length} color="warning" />
        <StatCard label="No limit recorded" value={report.no_capacity_set.length} color="info" />
        <StatCard
          label="Seats used"
          value={`${report.registered_total} / ${report.seats_total}`}
          color="primary"
        />
      </Stack>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Over capacity
      </Typography>
      {report.over.length === 0 ? (
        /* An empty over-capacity list means two completely different things depending on
           how many classes have no limit recorded. This says which one it is. */
        <Alert severity="success" sx={{ mb: 3 }}>
          No class has more registrations than the seats set for it.
          {report.no_capacity_set.length > 0 && (
            <>
              {' '}
              {report.no_capacity_set.length} of {report.offerings_total} classes have no
              capacity recorded at all, so they could not appear here either way — they are
              listed below.
            </>
          )}
        </Alert>
      ) : (
        <CapacityTable rows={report.over} showOverBy />
      )}

      {report.at_capacity.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Exactly full
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            Not a fault. The next registration makes it one.
          </Typography>
          <CapacityTable rows={report.at_capacity} showOverBy={false} />
        </>
      )}

      {report.no_capacity_set.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            No capacity recorded
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            These cannot be over capacity — not because they have room, but because nobody
            has said how much room they have.
          </Typography>
          <CapacityTable rows={report.no_capacity_set} showOverBy={false} />
        </>
      )}

      <Typography variant="body2" color="text.secondary">
        {report.under_capacity} of {report.offerings_total} classes have seats to spare and
        are not listed.
      </Typography>
      <ReportNote note={report.note} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Credit load (§53 Registration)
// ══════════════════════════════════════════════════════════════════════════════
function CreditLoadPanel({ report }: { report: CreditLoadReport }) {
  const flagged = useMemo(() => report.rows.filter((r) => r.mismatch), [report.rows]);
  return (
    <>
      <ScopeNotice scope={report.scope} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <StatCard
          label="Students registered"
          value={report.students}
          icon={<ScaleOutlinedIcon />}
          color="primary"
        />
        <StatCard
          label="Average credits"
          value={report.avg_credits}
          color="info"
          helperText={`${report.min_credits}–${report.max_credits} credits`}
        />
        <StatCard
          label="Load disagrees with declaration"
          value={report.mismatches}
          color={report.mismatches > 0 ? 'warning' : 'success'}
        />
      </Stack>

      {report.mismatches > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {report.mismatches} of {report.students} students are carrying a load that
          contradicts what they declared at admission, measured against BAJC&apos;s own
          application form ({report.full_time_credits} credits). The declaration is a
          statement of intent made once; the credits are what they are doing now.
        </Alert>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        By declared load
      </Typography>
      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Declared at admission</TableCell>
              <TableCell align="right">Students</TableCell>
              <TableCell align="right">Lowest</TableCell>
              <TableCell align="right">Highest</TableCell>
              <TableCell align="right">Average</TableCell>
              <TableCell align="right">Disagreements</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {report.by_declared_load.map((row) => (
              <TableRow key={row.declared_load}>
                <TableCell>{row.declared_load}</TableCell>
                <TableCell align="right">{row.students}</TableCell>
                <TableCell align="right">{row.min_credits}</TableCell>
                <TableCell align="right">{row.max_credits}</TableCell>
                <TableCell align="right">{row.avg_credits}</TableCell>
                <TableCell align="right">{row.mismatches}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Credits carried
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
        {report.distribution.map((band) => (
          <Chip
            key={band.credits}
            size="small"
            variant="outlined"
            label={`${band.credits} credits — ${band.students} ${
              band.students === 1 ? 'student' : 'students'
            }`}
          />
        ))}
      </Stack>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {flagged.length > 0 ? 'Every student, disagreements first' : 'Every student'}
      </Typography>
      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Student</TableCell>
              <TableCell>Number</TableCell>
              <TableCell>Programme</TableCell>
              <TableCell>Declared</TableCell>
              <TableCell align="right">Courses</TableCell>
              <TableCell align="right">Credits</TableCell>
              <TableCell align="right">Audited</TableCell>
              <TableCell>Note</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[...flagged, ...report.rows.filter((r) => !r.mismatch)].map((row) => (
              <TableRow key={row.student.id}>
                <TableCell>{row.student.full_name}</TableCell>
                <TableCell>{row.student.student_number}</TableCell>
                <TableCell>{row.programme ?? '—'}</TableCell>
                <TableCell>{row.declared_load ?? 'Not declared'}</TableCell>
                <TableCell align="right">{row.courses}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  {row.credits}
                </TableCell>
                {/* Included in the credits — an audit is real work — and shown apart,
                    because it earns nothing towards the award. */}
                <TableCell align="right">{row.audit_credits || '—'}</TableCell>
                <TableCell sx={{ color: 'warning.main' }}>{row.mismatch ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ReportNote note={report.note} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Attendance by programme (§53 Attendance — the "department" report, C4)
// ══════════════════════════════════════════════════════════════════════════════
function AttendancePanel({
  report,
  programId,
  onProgrammeChange,
}: {
  report: ProgrammeAttendanceReport;
  programId: string;
  onProgrammeChange: (id: string) => void;
}) {
  const programmes = useProgramsList({ page: 1, page_size: 100 });
  const belowFloor = report.by_programme.filter((r) => r.below_floor);

  return (
    <>
      <ScopeNotice scope={report.scope} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <StatCard
          label="Attendance"
          value={pct(report.pct_present)}
          icon={<EventAvailableOutlinedIcon />}
          color={report.pct_present < report.floor_pct ? 'error' : 'success'}
          helperText={`Floor ${report.floor_pct}%`}
        />
        <StatCard
          label="Programmes below the floor"
          value={belowFloor.length}
          color={belowFloor.length > 0 ? 'error' : 'success'}
        />
        <StatCard label="Registers taken" value={report.records_total} color="primary" />
      </Stack>

      <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto', mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Programme</TableCell>
              <TableCell align="right">Students marked</TableCell>
              <TableCell align="right">Registers</TableCell>
              <TableCell align="right">Present</TableCell>
              <TableCell align="right">Absent</TableCell>
              <TableCell align="right">Late</TableCell>
              <TableCell align="right">Excused</TableCell>
              <TableCell align="right">Attendance</TableCell>
              <TableCell align="right">Students below floor</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {report.by_programme.map((row) => (
              <TableRow key={row.programme}>
                <TableCell>{row.programme}</TableCell>
                <TableCell align="right">{row.students}</TableCell>
                <TableCell align="right">{row.records}</TableCell>
                <TableCell align="right">{row.present}</TableCell>
                <TableCell align="right">{row.absent}</TableCell>
                <TableCell align="right">{row.late}</TableCell>
                <TableCell align="right">{row.excused}</TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 600,
                    color: row.below_floor ? 'error.main' : 'text.primary',
                  }}
                >
                  {pct(row.pct_present)}
                </TableCell>
                <TableCell align="right">{row.students_below_floor || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Divider sx={{ mb: 2 }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems="center">
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="prog-attendance-drill">Look inside one programme</InputLabel>
          <Select
            labelId="prog-attendance-drill"
            label="Look inside one programme"
            value={programId}
            onChange={(e) => onProgrammeChange(e.target.value)}
          >
            <MenuItem value="">Every programme (summary only)</MenuItem>
            {(programmes.data?.items ?? []).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {report.programme && (
          <Typography variant="body2" color="text.secondary">
            {report.programme.programme}: {pct(report.programme.pct_present)} across{' '}
            {report.programme.records} registers.
          </Typography>
        )}
      </Stack>

      {programId !== '' &&
        (report.students.length === 0 ? (
          <EmptyState
            title="No registers taken for this programme this session"
            description="Nobody has been marked, so there is no percentage to show. That is different from poor attendance."
          />
        ) : (
          <TableContainer component={Card} variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell>Number</TableCell>
                  <TableCell align="right">Registers</TableCell>
                  <TableCell align="right">Present</TableCell>
                  <TableCell align="right">Absent</TableCell>
                  <TableCell align="right">Late</TableCell>
                  <TableCell align="right">Excused</TableCell>
                  <TableCell align="right">Attendance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.students.map((row) => (
                  <TableRow key={row.student.id}>
                    <TableCell>{row.student.full_name}</TableCell>
                    <TableCell>{row.student.student_number}</TableCell>
                    <TableCell align="right">{row.records}</TableCell>
                    <TableCell align="right">{row.present}</TableCell>
                    <TableCell align="right">{row.absent}</TableCell>
                    <TableCell align="right">{row.late}</TableCell>
                    <TableCell align="right">{row.excused}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontWeight: 600,
                        color: row.below_floor ? 'error.main' : 'text.primary',
                      }}
                    >
                      {pct(row.pct_present)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ))}
      <ReportNote note={report.note} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export function CollegeReportsScreen() {
  const [tab, setTab] = useState<ReportKey>('intake');
  const [semesterId, setSemesterId] = useState('');
  const [yearId, setYearId] = useState('');
  const [programId, setProgramId] = useState('');

  const activeTerm = useActiveTerm();
  const years = useAcademicYears();

  // Default both pickers to what is active, once it loads. The intake report is
  // YEAR-scoped and the other three are SESSION-scoped; they are separate controls
  // because they are separate questions, and a single picker would have forced one of
  // them to be wrong.
  useEffect(() => {
    if (!semesterId && activeTerm.data?.semester?.id) setSemesterId(activeTerm.data.semester.id);
    if (!yearId && activeTerm.data?.academic_year?.id) setYearId(activeTerm.data.academic_year.id);
  }, [activeTerm.data, semesterId, yearId]);

  // Only the report on screen fetches. Four college-wide queries on every render of the
  // tab bar is four times the work for three answers nobody is looking at.
  const intake = useNewVsReturning(yearId || undefined, tab === 'intake');
  const capacity = useOvercapacity(semesterId || undefined, tab === 'capacity');
  const load = useCreditLoad(semesterId || undefined, tab === 'load');
  const attendance = useProgrammeAttendance(
    semesterId || undefined,
    programId || undefined,
    tab === 'attendance',
  );

  const query = { intake, capacity, load, attendance }[tab];

  return (
    <Box>
      <PageHeader
        title="College reports"
        subtitle="Intake, class capacity, credit load and attendance across the college."
      />

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {tab === 'intake' ? (
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="college-report-year">Academic year</InputLabel>
                <Select
                  labelId="college-report-year"
                  label="Academic year"
                  value={yearId}
                  onChange={(e) => setYearId(e.target.value)}
                >
                  {(years.data?.items ?? []).map((y) => (
                    <MenuItem key={y.id} value={y.id}>
                      {y.name}
                      {y.status === 'active' ? ' (active)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <TermPicker value={semesterId} onChange={setSemesterId} />
            )}
          </Stack>
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onChange={(_e, next: ReportKey) => setTab(next)}
        aria-label="College reports"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      {query.isLoading ? (
        <LoadingState variant="cards" rows={4} label="Building the report" />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <EmptyState title="Nothing to report yet" variant="page" />
      ) : tab === 'intake' ? (
        <IntakePanel report={intake.data as NewVsReturningReport} />
      ) : tab === 'capacity' ? (
        <CapacityPanel report={capacity.data as OvercapacityReport} />
      ) : tab === 'load' ? (
        <CreditLoadPanel report={load.data as CreditLoadReport} />
      ) : (
        <AttendancePanel
          report={attendance.data as ProgrammeAttendanceReport}
          programId={programId}
          onProgrammeChange={setProgramId}
        />
      )}
    </Box>
  );
}

export default CollegeReportsScreen;
