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
import { useClassSubjectOptions } from './hooks/useGrades';
import { SubjectGradesScreen } from './SubjectGradesScreen';
import type { ClassSubjectOption } from './types';

const CLASS_SUBJECT_PARAM = 'class_subject_id';

/**
 * Grades entry point — a GRID OF SUBJECT CARDS (mirrors the student "My Grades" pattern).
 * Click a subject to drill into its assessments + grading (SubjectGradesScreen). Teacher
 * sees the subjects they teach; P/S see all (read-only downstream). Students use My Grades.
 * Selection + year persist to the URL (`?class_subject_id=`, `?year=`).
 */
export function GradeAssessmentsScreen() {
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  // P/S browse every offering school-wide; give them Teacher/Form/Section narrowing filters.
  // Teachers see only their own subjects, so these would be noise for them.
  const showClassFilters = user?.role === 'principal' || user?.role === 'secretary';
  const { yearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(CLASS_SUBJECT_PARAM);

  const optionsQuery = useClassSubjectOptions(yearId);
  const options = useMemo(() => optionsQuery.data?.items ?? [], [optionsQuery.data]);
  const selected = useMemo(
    () => options.find((o) => o.id === selectedId) ?? null,
    [options, selectedId],
  );

  // ── Teacher / Form / Section filters (P/S only) ──────────────────────────────────
  const [teacherId, setTeacherId] = useState('');
  const [form, setForm] = useState('');
  const [sectionLetter, setSectionLetter] = useState('');

  // Distinct filter options derived from the offerings the caller can see.
  const { teachers, forms, sectionLetters } = useMemo(() => {
    const teacherMap = new Map<string, string>();
    const formSet = new Set<string>();
    const letterSet = new Set<string>();
    for (const o of options) {
      for (const t of o.teachers) teacherMap.set(t.id, t.full_name);
      if (o.section?.grade_level) formSet.add(o.section.grade_level);
      if (o.section?.section) letterSet.add(o.section.section);
    }
    return {
      teachers: [...teacherMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      forms: [...formSet].sort((a, b) => a.localeCompare(b)),
      sectionLetters: [...letterSet].sort((a, b) => a.localeCompare(b)),
    };
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!showClassFilters) return options;
    return options.filter(
      (o) =>
        (!teacherId || o.teachers.some((t) => t.id === teacherId)) &&
        (!form || o.section?.grade_level === form) &&
        (!sectionLetter || o.section?.section === sectionLetter),
    );
  }, [options, showClassFilters, teacherId, form, sectionLetter]);

  // Drop a stale ?class_subject_id= that isn't in the current year's options.
  useEffect(() => {
    if (selectedId && options.length > 0 && !options.some((o) => o.id === selectedId)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(CLASS_SUBJECT_PARAM);
          return next;
        },
        { replace: true },
      );
    }
  }, [selectedId, options, setSearchParams]);

  const openSubject = (id: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(CLASS_SUBJECT_PARAM, id);
      return next;
    });
  const backToGrid = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(CLASS_SUBJECT_PARAM);
      return next;
    });
  const changeYear = (id: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('year', id);
        next.delete(CLASS_SUBJECT_PARAM);
        return next;
      },
      { replace: true },
    );

  // ── Drill-down ────────────────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <SubjectGradesScreen
        option={selected}
        classSubjectId={selectedId}
        canAuthor={Boolean(selected?.can_edit)}
        onBack={backToGrid}
      />
    );
  }

  // ── Subject card grid ───────────────────────────────────────────────────────────
  const subtitle = isTeacher
    ? 'Pick a subject to view its assessments and grade the class.'
    : 'Browse subjects. Grade entry is done by the subject teacher.';

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

        {showClassFilters && (
          <>
            <TextField
              select
              size="small"
              label="Teacher"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              disabled={teachers.length === 0}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">All teachers</MenuItem>
              {teachers.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Form"
              value={form}
              onChange={(e) => setForm(e.target.value)}
              disabled={forms.length === 0}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">All forms</MenuItem>
              {forms.map((f) => (
                <MenuItem key={f} value={f}>
                  {f}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Section"
              value={sectionLetter}
              onChange={(e) => setSectionLetter(e.target.value)}
              disabled={sectionLetters.length === 0}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="">All sections</MenuItem>
              {sectionLetters.map((l) => (
                <MenuItem key={l} value={l}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
      </Stack>

      {optionsQuery.isLoading && <LoadingState variant="cards" rows={6} label="Loading subjects" />}

      {optionsQuery.isError && (
        <ErrorState
          message="We couldn't load your subjects."
          onRetry={() => void optionsQuery.refetch()}
        />
      )}

      {!optionsQuery.isLoading && !optionsQuery.isError && options.length === 0 && (
        <EmptyState
          variant="page"
          title="No subjects"
          description={
            isTeacher
              ? 'You are not assigned to any subjects in this year.'
              : 'No subjects were found for this year.'
          }
        />
      )}

      {options.length > 0 && filteredOptions.length === 0 && (
        <EmptyState
          variant="page"
          title="No subjects match these filters"
          description="Try clearing the teacher, form, or section filter."
        />
      )}

      {filteredOptions.length > 0 && (
        <Grid container spacing={2}>
          {filteredOptions.map((cs) => (
            <Grid item xs={12} sm={6} md={4} key={cs.id}>
              <SubjectCard option={cs} onOpen={() => openSubject(cs.id)} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

function SubjectCard({ option, onOpen }: { option: ClassSubjectOption; onOpen: () => void }) {
  const teacherName = option.teachers[0]?.full_name;
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea onClick={onOpen} aria-label={`Open ${option.display_name}`} sx={{ height: '100%' }}>
        <CardContent>
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" noWrap>
              {option.subject?.name ?? 'Subject'}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {option.section?.name ?? 'Class'}
              {teacherName ? ` · ${teacherName}` : ''}
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
