import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { FormDialog } from '@shared/components';
import { useAcademicYears } from '@features/settings/hooks/useSettings';
import { useCoursesList } from '@features/settings/hooks/useCourses';
import { useTeachersList } from '@features/teachers/hooks/useTeachers';
import { strings } from '@i18n/strings';
import { MeetingRowsEditor } from './MeetingRowsEditor';
import { meetingRowInvalid } from '../meetingFormat';
import type { OfferingCreateBody, OfferingMeetingInput } from '../types';

export interface OfferingFormDialogProps {
  open: boolean;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: OfferingCreateBody) => void;
  onClose: () => void;
}

/**
 * Create a course offering (POST /offerings).
 *
 * **D31 — three fields went away and one arrived, and the form is simpler for it.**
 *
 *  - **No "Offering name".** An offering stores no name; the label is derived from course
 *    code + section + term and computed server-side. Asking for one invited two people to
 *    type "Math-1" and "Math 1" for the same thing, and then rendering both.
 *  - **No "Year group".** `grade_level` went with the homeroom. It was `NOT NULL`, so every
 *    offering had to declare a Form even when the concept did not apply.
 *  - **"Academic year" became "Term".** An offering belongs to a SEMESTER, not a year —
 *    that is the whole point of D31, and it is what lets the same course run in Semester 1
 *    and again in Semester 2. The picker lists every semester of every year (grouped by
 *    year, active term preselected) rather than making the user choose a year and then a
 *    term inside it.
 *  - **"Section" became "Section code"** — "01"/"02" for parallel sections of one course,
 *    not the homeroom's division letter. Leaving it blank means "the only section", and a
 *    SECOND blank-section offering of the same course in the same term is refused by the
 *    server (409): that is the `COALESCE` in the unique index doing its job.
 *
 * `course_id` is REQUIRED — an offering IS an offering OF a catalog course, and one without
 * a course cannot be graded, scheduled or enrolled into. Lecturers and the weekly schedule
 * are optional but accepted in the same request, so "MATH1110-01, Mr. Smith, Room A, Mon
 * 08:00–09:30" is one action.
 *
 * Cross-offering scheduling conflicts are NOT validated here — the server reports them as
 * warnings after the create (see the Schedule tab), because only it can see the others.
 */
export function OfferingFormDialog({
  open,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: OfferingFormDialogProps) {
  const yearsQuery = useAcademicYears();

  /**
   * Every semester, flattened out of the years, each carrying its year name for the label.
   * Ordered newest year first then by term sequence, so the current term is near the top.
   *
   * The `?? []` fallback lives INSIDE the callback and the dep is the query data itself: a
   * `data?.items ?? []` computed outside would be a fresh array on every render, so the memo
   * would recompute every time and the `activeSemesterId` effect below would re-fire with it.
   */
  const semesterOptions = useMemo(
    () =>
      [...(yearsQuery.data?.items ?? [])]
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
        .flatMap((y) =>
          [...y.semesters]
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => ({
              id: s.id,
              label: `${s.name} — ${y.name}`,
              isActive: s.is_active,
            })),
        ),
    [yearsQuery.data],
  );
  const activeSemesterId = semesterOptions.find((s) => s.isActive)?.id ?? '';

  // Fetched only while the dialog is open — both are pickers nobody needs otherwise.
  const coursesQuery = useCoursesList({ page: 1, page_size: 200, sort: 'code' });
  const teachersQuery = useTeachersList({ page: 1, page_size: 200, sort: 'full_name' }, open);
  const courses = coursesQuery.data?.items ?? [];
  const teachers = useMemo(() => teachersQuery.data?.items ?? [], [teachersQuery.data]);

  const [courseId, setCourseId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [sectionCode, setSectionCode] = useState('');
  const [capacity, setCapacity] = useState('');
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [meetings, setMeetings] = useState<OfferingMeetingInput[]>([]);

  useEffect(() => {
    if (open) {
      setCourseId('');
      setSemesterId(activeSemesterId);
      setSectionCode('');
      setCapacity('');
      setTeacherIds([]);
      setMeetings([]);
    }
  }, [open, activeSemesterId]);

  const badMeeting = meetings.some(meetingRowInvalid);
  const submitDisabled = courseId.length === 0 || semesterId.length === 0 || badMeeting;

  const selectedTeachers = teachers.filter((t) => teacherIds.includes(t.id));

  return (
    <FormDialog
      open={open}
      title={`Add ${strings.terms.courseOffering.toLowerCase()}`}
      submitLabel="Create offering"
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          course_id: courseId,
          semester_id: semesterId,
          // Empty optionals go as null, not "" — the API validates max_length on a string
          // and would reject an empty section code outright.
          section_code: sectionCode.trim() || null,
          capacity: capacity.trim() ? Number(capacity) : null,
          teacher_ids: teacherIds,
          meetings: meetings.map((m) => ({ ...m, room: m.room?.trim() || null })),
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          select
          label={strings.terms.course}
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
          fullWidth
          autoFocus
          disabled={coursesQuery.isLoading}
          error={Boolean(fieldErrors?.course_id)}
          helperText={
            fieldErrors?.course_id?.join(' ') ?? 'From the course catalog — the Dean owns it.'
          }
        >
          {courses.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.code} — {c.name}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Term"
            value={semesterId}
            onChange={(e) => setSemesterId(e.target.value)}
            required
            fullWidth
            disabled={yearsQuery.isLoading}
            error={Boolean(fieldErrors?.semester_id)}
            helperText={
              fieldErrors?.semester_id?.join(' ') ??
              'The same course can be offered again in another term.'
            }
          >
            {semesterOptions.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
                {s.isActive ? ' (current)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Section code"
            value={sectionCode}
            onChange={(e) => setSectionCode(e.target.value)}
            fullWidth
            placeholder="01"
            error={Boolean(fieldErrors?.section_code)}
            helperText={
              fieldErrors?.section_code?.join(' ') ??
              'Only for parallel sections. Leave blank if there is just one.'
            }
          />
        </Stack>

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
              label="Lecturer(s)"
              placeholder={teacherIds.length === 0 ? 'Optional — can be assigned later' : undefined}
              error={Boolean(fieldErrors?.teacher_ids)}
              helperText={
                fieldErrors?.teacher_ids?.join(' ') ??
                'The first lecturer selected becomes the lead.'
              }
            />
          )}
        />

        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">Weekly schedule</Typography>
          <Typography variant="caption" color="text.secondary">
            Optional now — you can add times later from the offering's Schedule tab. Clashes
            with other offerings are checked when you save and shown as warnings.
          </Typography>
        </Stack>
        <MeetingRowsEditor value={meetings} onChange={setMeetings} disabled={submitting} dense />
      </Stack>
    </FormDialog>
  );
}

export default OfferingFormDialog;
