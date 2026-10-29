import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchableSelect,
  SessionSelect,
  YearSelect,
} from '@shared/components';
import PrintIcon from '@mui/icons-material/Print';
import { StudentPicker } from '@features/reports/components/StudentPicker';
import type { StudentRef as ReportStudentRef } from '@features/reports/types';
import { AssessmentReportPrintDialog } from './components/AssessmentReportPrintDialog';
import { useSessionFilter, useYearFilter } from '@shared/hooks';
import { useAuth } from '@features/auth/hooks/useAuth';
import { strings } from '@i18n/strings';
import { useOfferingOptions } from './hooks/useGrades';
import { OfferingGradesScreen } from './OfferingGradesScreen';
import type { OfferingOption } from './types';
import { isLecturerRole } from '@shared/auth/permissions';

const OFFERING_PARAM = 'offering_id';

/**
 * Grades entry point — a GRID OF OFFERING CARDS (mirrors the student "My Grades" pattern).
 * Click one to drill into its assessments + grading (OfferingGradesScreen). A lecturer sees
 * the offerings they teach; the Dean and Registrar see all (read-only downstream). Students
 * use My Grades. Selection + year persist to the URL (`?offering_id=`, `?year=`).
 *
 * **D31 replaced the Form / Section filters with a Term filter.** Those two read
 * `option.section.grade_level` and `option.section.section` — the homeroom's Form and its
 * division letter, both dropped with the `classes` table. The term took their place because
 * it is what now separates two otherwise identical cards: the same course legitimately has a
 * gradebook in Semester 1 and another in Semester 2, and those are different books. A
 * year-scoped picker could not express that at all.
 *
 * **D47 — Print lives here**, on the main page rather than inside each offering. The Dean
 * filters by session, course offering, student and lecturer; a lecturer by session and
 * their own course offerings (the server holds them to their own whatever is sent). The
 * Registrar and Auditor browse but do not print.
 */
export function GradeAssessmentsScreen() {
  const { user } = useAuth();
  const isTeacher = isLecturerRole(user?.role); // D43 — an HOD is a lecturer
  // The Dean and Registrar browse every offering school-wide, so they get Lecturer/Term
  // narrowing. A lecturer sees only their own, where these would be noise.
  const showBrowseFilters = user?.role === 'principal' || user?.role === 'secretary';
  const isDean = user?.role === 'principal';
  // D47 — the assessment report is the Dean's and the lecturers' (their own courses).
  const canPrint = isDean || isTeacher;
  const { yearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();
  // Session beside the year, for every role, defaulting to the active one. Any other
  // session is browsed read-only — the server reports `can_edit: false` for it too.
  const session = useSessionFilter(yearId);

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(OFFERING_PARAM);

  const optionsQuery = useOfferingOptions(yearId);
  const options = useMemo(() => optionsQuery.data?.items ?? [], [optionsQuery.data]);
  const selected = useMemo(
    () => options.find((o) => o.offering.id === selectedId) ?? null,
    [options, selectedId],
  );

  // ── Lecturer filter (Dean + Registrar only) ──────────────────────────────────────
  const [teacherId, setTeacherId] = useState('');
  // ── D47 — course offering (everyone) and student (Dean) filters, + print ────────
  const [offeringFilter, setOfferingFilter] = useState('');
  const [student, setStudent] = useState<ReportStudentRef | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  // Distinct lecturers derived from the offerings the caller can see.
  const teachers = useMemo(() => {
    const teacherMap = new Map<string, string>();
    for (const o of options) for (const t of o.teachers) teacherMap.set(t.id, t.full_name);
    return [...teacherMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [options]);

  const filteredOptions = useMemo(
    () =>
      options.filter(
        (o) =>
          (!session.sessionId || o.offering.semester?.id === session.sessionId) &&
          (!showBrowseFilters || !teacherId || o.teachers.some((t) => t.id === teacherId)) &&
          (!offeringFilter || o.offering.id === offeringFilter),
      ),
    [options, session.sessionId, showBrowseFilters, teacherId, offeringFilter],
  );

  // The offering dropdown lists what the OTHER filters leave, so it never offers a course
  // that the session or lecturer filter has already ruled out.
  const offeringChoices = useMemo(
    () =>
      options
        .filter(
          (o) =>
            (!session.sessionId || o.offering.semester?.id === session.sessionId) &&
            (!showBrowseFilters || !teacherId || o.teachers.some((t) => t.id === teacherId)),
        )
        .map((o) => ({ value: o.offering.id, label: o.offering.label, hint: o.offering.course.name })),
    [options, session.sessionId, showBrowseFilters, teacherId],
  );

  const printParams = useMemo(
    () => ({
      academic_year_id: yearId || undefined,
      semester_id: session.sessionId || undefined,
      offering_id: offeringFilter || undefined,
      student_id: isDean ? student?.id : undefined,
      teacher_id: isDean ? teacherId || undefined : undefined,
    }),
    [yearId, session.sessionId, offeringFilter, isDean, student, teacherId],
  );
  const printSummary = useMemo(() => {
    const parts: string[] = [];
    const year = years.find((y) => y.id === yearId);
    if (year) parts.push(year.name);
    const sess = session.sessions.find((x) => x.id === session.sessionId);
    if (sess) parts.push(sess.name);
    const off = options.find((o) => o.offering.id === offeringFilter);
    if (off) parts.push(off.offering.label);
    if (isDean && teacherId) {
      const t = teachers.find((x) => x.id === teacherId);
      if (t) parts.push(`Lecturer: ${t.name}`);
    }
    if (isDean && student) parts.push(`Student: ${student.full_name}`);
    return parts;
  }, [years, yearId, session.sessions, session.sessionId, options, offeringFilter, isDean, teacherId, teachers, student]);

  // Drop a stale ?offering_id= that isn't in the current year's options.
  useEffect(() => {
    if (selectedId && options.length > 0 && !options.some((o) => o.offering.id === selectedId)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(OFFERING_PARAM);
          return next;
        },
        { replace: true },
      );
    }
  }, [selectedId, options, setSearchParams]);

  const openOffering = (id: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(OFFERING_PARAM, id);
      return next;
    });
  const backToGrid = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(OFFERING_PARAM);
      return next;
    });
  const changeYear = (id: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('year', id);
        // A session belongs to one year; the new year resolves its own default.
        next.delete('session');
        next.delete(OFFERING_PARAM);
        return next;
      },
      { replace: true },
    );
  // A filter pinned to a course in another year would silently match nothing.
  useEffect(() => {
    setOfferingFilter('');
  }, [yearId, session.sessionId]);

  // ── Drill-down ────────────────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <OfferingGradesScreen
        option={selected}
        offeringId={selectedId}
        canAuthor={Boolean(selected?.can_edit)}
        onBack={backToGrid}
      />
    );
  }

  // ── Offering card grid ──────────────────────────────────────────────────────────
  const subtitle = isTeacher
    ? 'Pick a course to view its assessments and grade the class.'
    : 'Browse course offerings. Grade entry is done by the offering’s lecturer.';

  return (
    <Box sx={{ pt: 3 }}>
      <PageHeader
        title="Grades"
        subtitle={subtitle}
        primaryAction={
          canPrint ? (
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => setPrintOpen(true)}>
              Print assessments
            </Button>
          ) : undefined
        }
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        useFlexGap
        sx={{ mb: 2, alignItems: { sm: 'flex-start' }, flexWrap: 'wrap' }}
      >
        <YearSelect
          value={yearId}
          onChange={changeYear}
          years={years}
          activeYearId={activeYearId}
          isLoading={yearsLoading}
        />

        <SessionSelect
          value={session.sessionId}
          onChange={session.setSessionId}
          sessions={session.sessions}
          isLoading={session.isLoading}
        />

        {showBrowseFilters && (
          <>
            <TextField
              select
              size="small"
              label={strings.terms.lecturer}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              disabled={teachers.length === 0}
              // Show "All lecturers" rather than an empty box when nothing is picked.
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All lecturers</MenuItem>
              {teachers.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}

        <SearchableSelect
          label="Course offering"
          value={offeringFilter}
          onChange={setOfferingFilter}
          allOption="All course offerings"
          options={offeringChoices}
          loading={optionsQuery.isLoading}
          sx={{ minWidth: 240 }}
        />

        {/* The student filter narrows the PRINTED report to one student's marks. */}
        {isDean && <StudentPicker value={student} onChange={setStudent} />}
      </Stack>

      {!session.isLoading && session.sessionId && !session.isActive && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This session is not active. Its assessments and grades are read-only.
        </Alert>
      )}

      {optionsQuery.isLoading && (
        <LoadingState variant="cards" rows={6} label="Loading course offerings" />
      )}

      {optionsQuery.isError && (
        <ErrorState
          message="We couldn't load your course offerings."
          onRetry={() => void optionsQuery.refetch()}
        />
      )}

      {!optionsQuery.isLoading && !optionsQuery.isError && options.length === 0 && (
        <EmptyState
          variant="page"
          title="No course offerings"
          description={
            isTeacher
              ? 'You are not assigned to any offerings in this year.'
              : 'No course offerings were found for this year.'
          }
        />
      )}

      {options.length > 0 && filteredOptions.length === 0 && (
        <EmptyState
          variant="page"
          title="No offerings match these filters"
          description="Try another session, or clear the lecturer or course offering filter."
        />
      )}

      {canPrint && (
        <AssessmentReportPrintDialog
          open={printOpen}
          onClose={() => setPrintOpen(false)}
          params={printParams}
          filterSummary={printSummary}
        />
      )}

      {filteredOptions.length > 0 && (
        <Grid container spacing={2}>
          {filteredOptions.map((o) => (
            <Grid item xs={12} sm={6} md={4} key={o.offering.id}>
              <OfferingCard option={o} onOpen={() => openOffering(o.offering.id)} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

function OfferingCard({ option, onOpen }: { option: OfferingOption; onOpen: () => void }) {
  const teacherName = option.teachers[0]?.full_name;
  const { offering } = option;
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea
        onClick={onOpen}
        aria-label={`Open ${offering.label}`}
        sx={{ height: '100%' }}
      >
        <CardContent>
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" noWrap>
              {offering.course.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {/* Label + term + lecturer: the three facts that tell two cards for the same
                  course apart. */}
              {[offering.label, offering.semester?.name, teacherName].filter(Boolean).join(' · ')}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Chip
                size="small"
                variant="outlined"
                label={`${option.assessment_count} assessment${option.assessment_count === 1 ? '' : 's'}`}
              />
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default GradeAssessmentsScreen;
