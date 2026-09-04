import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
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
  YearSelect,
} from '@shared/components';
import { useYearFilter } from '@shared/hooks';
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
 */
export function GradeAssessmentsScreen() {
  const { user } = useAuth();
  const isTeacher = isLecturerRole(user?.role); // D43 — an HOD is a lecturer
  // The Dean and Registrar browse every offering school-wide, so they get Lecturer/Term
  // narrowing. A lecturer sees only their own, where these would be noise.
  const showBrowseFilters = user?.role === 'principal' || user?.role === 'secretary';
  const { yearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(OFFERING_PARAM);

  const optionsQuery = useOfferingOptions(yearId);
  const options = useMemo(() => optionsQuery.data?.items ?? [], [optionsQuery.data]);
  const selected = useMemo(
    () => options.find((o) => o.offering.id === selectedId) ?? null,
    [options, selectedId],
  );

  // ── Lecturer / Term filters (Dean + Registrar only) ──────────────────────────────
  const [teacherId, setTeacherId] = useState('');
  const [semesterId, setSemesterId] = useState('');

  // Distinct filter options derived from the offerings the caller can see.
  const { teachers, semesters } = useMemo(() => {
    const teacherMap = new Map<string, string>();
    const semesterMap = new Map<string, { name: string; sequence: number }>();
    for (const o of options) {
      for (const t of o.teachers) teacherMap.set(t.id, t.full_name);
      const sem = o.offering.semester;
      if (sem) semesterMap.set(sem.id, { name: sem.name, sequence: sem.sequence });
    }
    return {
      teachers: [...teacherMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      // Ordered by the term's own sequence, not by its name — "Semester 10" must not sort
      // before "Semester 2".
      semesters: [...semesterMap.entries()]
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => a.sequence - b.sequence),
    };
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!showBrowseFilters) return options;
    return options.filter(
      (o) =>
        (!teacherId || o.teachers.some((t) => t.id === teacherId)) &&
        (!semesterId || o.offering.semester?.id === semesterId),
    );
  }, [options, showBrowseFilters, teacherId, semesterId]);

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
        next.delete(OFFERING_PARAM);
        return next;
      },
      { replace: true },
    );

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
      <PageHeader title="Grades" subtitle={subtitle} />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'flex-start' }, flexWrap: 'wrap' }}
      >
        <YearSelect
          value={yearId}
          onChange={changeYear}
          years={years}
          activeYearId={activeYearId}
          isLoading={yearsLoading}
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
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All lecturers</MenuItem>
              {teachers.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Session"
              value={semesterId}
              onChange={(e) => setSemesterId(e.target.value)}
              disabled={semesters.length === 0}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All sessions</MenuItem>
              {semesters.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
      </Stack>

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
          description="Try clearing the lecturer or session filter."
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
