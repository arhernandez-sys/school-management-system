import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { FormDialog, SearchableSelect } from '@shared/components';
import { useClassroomOptions } from '@features/classrooms/hooks/useClassrooms';
import { useAcademicYears } from '@features/settings/hooks/useSettings';
import { useCoursesList } from '@features/settings/hooks/useCourses';
import { useTeachersList } from '@features/teachers/hooks/useTeachers';
import { strings } from '@i18n/strings';
import { MeetingRowsEditor } from './MeetingRowsEditor';
import { meetingRowInvalid } from '../meetingFormat';
import type {
  OfferingCreateBody,
  OfferingListItem,
  OfferingMeetingInput,
  OfferingUpdateBody,
} from '../types';

export interface OfferingFormDialogProps {
  open: boolean;
  /**
   * Edit mode when provided (create otherwise). D41 — the list's Edit button.
   *
   * A LIST ROW, not a detail: the row already carries everything this form shows in edit
   * mode (label, course, semester, section code, capacity, archive state), so opening the
   * dialog costs no request and cannot show a spinner over a form the user is looking at.
   */
  offering?: OfferingListItem | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: OfferingCreateBody) => void;
  /** Edit mode only. Called instead of `onSubmit`. */
  onUpdate?: (values: OfferingUpdateBody) => void;
  onClose: () => void;
}

/**
 * Create OR edit a course offering — `POST /offerings`, or `PATCH /offerings/{id}` when
 * `offering` is given (D41).
 *
 * **The two modes deliberately show different forms**, because the server accepts
 * different bodies. Create takes the course, the term, the lecturers and the weekly
 * schedule in one request; edit takes `section_code`, `capacity` and `is_archived` and
 * nothing else. Rendering the create form's other fields in edit mode and quietly
 * dropping them on save would be the worse lie: the Dean would change the lecturer,
 * press Save, and watch it revert. Lecturers and schedule have their own endpoints and
 * their own UI on the offering itself.
 *
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
  offering,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onUpdate,
  onClose,
}: OfferingFormDialogProps) {
  const editing = Boolean(offering);
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
  // D44 — the room this offering meets in. '' means none assigned, which is what all
  // 19 pre-D44 offerings are.
  const [classroomId, setClassroomId] = useState('');
  const [archived, setArchived] = useState(false);
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [meetings, setMeetings] = useState<OfferingMeetingInput[]>([]);
  // Held until the dialog is actually on screen, so opening the offerings LIST does
  // not fetch a room list nobody asked for.
  const classroomsQuery = useClassroomOptions(open);
  const classroomOptions = classroomsQuery.data?.items ?? [];

  useEffect(() => {
    if (!open) return;
    if (offering) {
      // Seeded from the row. Course and session are read-only here, but they are still
      // SET rather than blank — the two selects render the offering's real course and
      // term so the Dean can see what they are editing.
      setCourseId(offering.course?.id ?? '');
      setSemesterId(offering.semester?.id ?? '');
      setSectionCode(offering.section_code ?? '');
      setCapacity(offering.capacity == null ? '' : String(offering.capacity));
      setClassroomId(offering.classroom?.id ?? '');
      setArchived(offering.is_archived);
      return;
    }
    setClassroomId('');
    setCourseId('');
    setSemesterId(activeSemesterId);
    setSectionCode('');
    setCapacity('');
    setArchived(false);
    setTeacherIds([]);
    setMeetings([]);
  }, [open, offering, activeSemesterId]);

  const badMeeting = meetings.some(meetingRowInvalid);
  // In edit mode the two required selects are read-only and always populated, and the
  // meeting editor is not rendered — so neither gate can fail and the only thing that can
  // block a save is nothing at all.
  const submitDisabled = editing
    ? false
    : courseId.length === 0 || semesterId.length === 0 || badMeeting;

  const selectedTeachers = teachers.filter((t) => teacherIds.includes(t.id));

  return (
    <FormDialog
      open={open}
      title={
        editing
          ? `Edit ${strings.terms.courseOffering.toLowerCase()}`
          : `Add ${strings.terms.courseOffering.toLowerCase()}`
      }
      submitLabel={editing ? 'Save changes' : 'Create offering'}
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        editing
          ? onUpdate?.({
              // Only what `PATCH /offerings/{id}` accepts. Sent unconditionally rather
              // than diffed: all three are absolute values, so re-sending an unchanged
              // one is a no-op, and a diff would be a second place for "what changed" to
              // be computed wrongly.
              section_code: sectionCode.trim() || null,
              capacity: capacity.trim() ? Number(capacity) : null,
              // D44 — an explicit null UNASSIGNS the room, which is a thing a
              // Registrar does when a class moves. Sent unconditionally like the rest.
              classroom_id: classroomId || null,
              is_archived: archived,
            })
          : onSubmit({
              course_id: courseId,
              semester_id: semesterId,
              // Empty optionals go as null, not "" — the API validates max_length on a
              // string and would reject an empty section code outright.
              section_code: sectionCode.trim() || null,
              capacity: capacity.trim() ? Number(capacity) : null,
              classroom_id: classroomId || null,
              teacher_ids: teacherIds,
              meetings: meetings.map((m) => ({ ...m, room: m.room?.trim() || null })),
            })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        {/* D41 — said once, at the top, rather than as a surprise on two disabled
            controls. The Dean opening this to "move MATH1110 to Semester 2" needs to
            know that is not an edit before they look for the field. */}
        {editing && (
          <Alert severity="info">
            The course and session cannot be changed — every assessment, grade and
            enrolment already recorded is attached to this offering, and moving it would
            silently reinterpret all of them. Archive this offering and create the right
            one instead.
            <br />
            Lecturers and the weekly schedule are edited on the offering itself.
          </Alert>
        )}
        {/* D43-b — type-to-filter over the WHOLE catalog (114 courses). Creating an
            offering means finding one specific course, which is a search, not a scroll. */}
        <SearchableSelect
          label={strings.terms.course}
          value={courseId}
          onChange={setCourseId}
          options={courses.map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
          required
          fullWidth
          disabled={editing || coursesQuery.isLoading}
          loading={coursesQuery.isLoading}
          error={Boolean(fieldErrors?.course_id)}
          helperText={
            fieldErrors?.course_id?.join(' ') ??
            (editing
              ? 'Cannot be changed — see the note above.'
              : 'From the course catalog — the Dean owns it. Type a code or a name.')
          }
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Session"
            value={semesterId}
            onChange={(e) => setSemesterId(e.target.value)}
            required
            fullWidth
            disabled={editing || yearsQuery.isLoading}
            error={Boolean(fieldErrors?.semester_id)}
            helperText={
              fieldErrors?.semester_id?.join(' ') ??
              (editing
                ? 'Cannot be changed — see the note above.'
                : 'The same course can be offered again in another session.')
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

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Capacity"
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            fullWidth
            inputProps={{ min: 1 }}
            error={Boolean(fieldErrors?.capacity)}
            helperText={
              fieldErrors?.capacity?.join(' ') ?? 'Optional — leave blank for no limit.'
            }
          />
          {/* D44 — the room. Only ACTIVE rooms are offered: one taken out of service
              should not be bookable, and showing it greyed only invites the question.

              ⚠️ This does NOT yet drive the timetable, which still renders the free-text
              `room` on each meeting below. Two things describe the same fact until that
              is resolved — see docs/d44-sims10-and-meeting3.md. */}
          <TextField
            select
            label="Classroom"
            value={classroomId}
            onChange={(e) => setClassroomId(e.target.value)}
            fullWidth
            error={Boolean(fieldErrors?.classroom_id)}
            helperText={
              fieldErrors?.classroom_id?.join(' ') ??
              (classroomsQuery.isLoading ? 'Loading rooms…' : 'Optional — leave unset if not decided.')
            }
          >
            <MenuItem value="">
              <em>No room assigned</em>
            </MenuItem>
            {classroomOptions.map((room) => (
              <MenuItem key={room.id} value={room.id}>
                {room.label}
                {room.capacity > 0 ? ` · ${room.capacity} seats` : ''}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {/* The only write path to `is_archived` anywhere in the app. The list has printed
            an Active/Archived badge since D31 and nothing could set it, so an offering
            that had run its course stayed in every picker for good. */}
        {editing && (
          <FormControlLabel
            control={
              <Switch checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            }
            label="Archived"
          />
        )}
        {editing && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
            An archived offering keeps its roster, grades and history — it stops appearing
            as a current offering.
          </Typography>
        )}

        {!editing && (
          <>
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
          </>
        )}
      </Stack>
    </FormDialog>
  );
}

export default OfferingFormDialog;
