import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import { useAcademicYears } from '@features/settings/hooks/useSettings';
import { useSubjectsList } from '@features/settings/hooks/useSubjects';
import { useTeachersList } from '@features/teachers/hooks/useTeachers';
import { MeetingRowsEditor } from './MeetingRowsEditor';
import { meetingRowInvalid } from '../meetingFormat';
import type { ClassCreateBody, ClassMeetingInput } from '../types';

export interface ClassFormDialogProps {
  open: boolean;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: ClassCreateBody) => void;
  onClose: () => void;
}

/**
 * Create a subject class (POST /classes).
 *
 * **D29** — the subject is REQUIRED here. A class without one cannot be graded, scheduled
 * or enrolled into, and the API rejects it, so it is a first-class field rather than
 * something attached afterwards on a separate tab (which is how the retired homeroom model
 * worked). Teachers and the weekly schedule are optional but accepted in the same request,
 * so "Math-1, Mr. Smith, Room A, Mon 08:00–09:30" is one action.
 *
 * `section` and `capacity` are optional: a sixth-form subject class rarely has a division
 * letter, and an uncapped class is normal. They used to be required, which forced the user
 * to invent values.
 *
 * Cross-class scheduling conflicts are NOT validated here — the server reports them as
 * warnings after the create (see the Schedule tab), because only it can see other classes.
 */
export function ClassFormDialog({
  open,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: ClassFormDialogProps) {
  const yearsQuery = useAcademicYears();
  const years = yearsQuery.data?.items ?? [];
  const activeYearId = years.find((y) => y.status === 'active')?.id ?? '';

  // Fetched only while the dialog is open — both are pickers nobody needs otherwise.
  const subjectsQuery = useSubjectsList({ page: 1, page_size: 200, sort: 'name' });
  const teachersQuery = useTeachersList({ page: 1, page_size: 200, sort: 'full_name' }, open);
  const subjects = subjectsQuery.data?.items ?? [];
  const teachers = useMemo(() => teachersQuery.data?.items ?? [], [teachersQuery.data]);

  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [section, setSection] = useState('');
  const [capacity, setCapacity] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [meetings, setMeetings] = useState<ClassMeetingInput[]>([]);

  useEffect(() => {
    if (open) {
      setName('');
      setSubjectId('');
      setGradeLevel('');
      setSection('');
      setCapacity('');
      setAcademicYearId(activeYearId);
      setTeacherIds([]);
      setMeetings([]);
    }
  }, [open, activeYearId]);

  const badMeeting = meetings.some(meetingRowInvalid);
  const submitDisabled =
    name.trim().length === 0 ||
    subjectId.length === 0 ||
    gradeLevel.trim().length === 0 ||
    academicYearId.length === 0 ||
    badMeeting;

  const selectedTeachers = teachers.filter((t) => teacherIds.includes(t.id));

  return (
    <FormDialog
      open={open}
      title="Add subject class"
      submitLabel="Create class"
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          name: name.trim(),
          subject_id: subjectId,
          grade_level: gradeLevel.trim(),
          // Empty optionals go as null, not "" — the API validates max_length on a string
          // and would reject an empty section outright.
          section: section.trim() || null,
          capacity: capacity.trim() ? Number(capacity) : null,
          academic_year_id: academicYearId,
          teacher_ids: teacherIds,
          meetings: meetings.map((m) => ({ ...m, room: m.room?.trim() || null })),
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Class name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            autoFocus
            placeholder="Math-1"
            helperText={fieldErrors?.name?.join(' ') ?? 'How the class is identified, e.g. "Math-1".'}
            error={Boolean(fieldErrors?.name)}
          />
          <TextField
            select
            label="Subject"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            required
            fullWidth
            disabled={subjectsQuery.isLoading}
            error={Boolean(fieldErrors?.subject_id)}
            helperText={fieldErrors?.subject_id?.join(' ')}
          >
            {subjects.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Year group"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            required
            fullWidth
            placeholder="Lower 6"
            error={Boolean(fieldErrors?.grade_level)}
            helperText={
              fieldErrors?.grade_level?.join(' ') ?? 'Which level this class is for.'
            }
          />
          <TextField
            label="Section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            fullWidth
            placeholder="A"
            error={Boolean(fieldErrors?.section)}
            helperText={fieldErrors?.section?.join(' ') ?? 'Optional.'}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Capacity"
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            fullWidth
            inputProps={{ min: 1 }}
            error={Boolean(fieldErrors?.capacity)}
            helperText={fieldErrors?.capacity?.join(' ') ?? 'Optional — leave blank for no limit.'}
          />
          <TextField
            select
            label="Academic year"
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            required
            fullWidth
            disabled={yearsQuery.isLoading}
            error={Boolean(fieldErrors?.academic_year_id)}
            helperText={fieldErrors?.academic_year_id?.join(' ')}
          >
            {years.map((y) => (
              <MenuItem key={y.id} value={y.id}>
                {y.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Autocomplete
          multiple
          options={teachers}
          value={selectedTeachers}
          onChange={(_e, next) => setTeacherIds(next.map((t) => t.id))}
          getOptionLabel={(t) => t.full_name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          loading={teachersQuery.isLoading}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Teacher(s)"
              placeholder={teacherIds.length === 0 ? 'Optional — can be assigned later' : undefined}
              error={Boolean(fieldErrors?.teacher_ids)}
              helperText={
                fieldErrors?.teacher_ids?.join(' ') ??
                'The first teacher selected becomes the lead.'
              }
            />
          )}
        />

        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">Weekly schedule</Typography>
          <Typography variant="caption" color="text.secondary">
            Optional now — you can add times later from the class's Schedule tab. Clashes with
            other classes are checked when you save and shown as warnings.
          </Typography>
        </Stack>
        <MeetingRowsEditor
          value={meetings}
          onChange={setMeetings}
          disabled={submitting}
          dense
        />
      </Stack>
    </FormDialog>
  );
}

export default ClassFormDialog;
