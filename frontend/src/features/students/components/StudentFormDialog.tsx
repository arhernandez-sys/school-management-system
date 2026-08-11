import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import { schoolToday } from '@shared/utils/schoolDate';
import type { StudentDetail, StudentWritePayload } from '../types';
import { useClassOptions } from '../hooks/useSections';

export interface StudentFormDialogProps {
  open: boolean;
  /** Edit mode when provided (create otherwise). */
  student?: StudentDetail | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: StudentWritePayload) => void;
  onClose: () => void;
}

/**
 * Create / edit a student (api-spec §5.3).
 *
 * Create requires student number, full name, date of birth and enrollment date. **D29**:
 * `year_group` (the student's own level) is a field here, and MANY subject classes can be
 * picked to enrol into on create — it used to be a single "Section" select, which cannot
 * express a sixth-former's subject load.
 *
 * On edit, class enrollment is NOT changed here: the API rejects it on PATCH, because with
 * many enrolments "set them from here" is ambiguous about removals. Enrollment moves live
 * under Classes → Roster. Year group IS editable, since it is a plain profile field.
 *
 * A 409 duplicate_student_number is surfaced by the parent.
 */
export function StudentFormDialog({
  open,
  student,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: StudentFormDialogProps) {
  const editing = Boolean(student);
  // Only needed by the create form's class picker.
  const classesQuery = useClassOptions(open && !editing);
  const classOptions = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);

  const [studentNumber, setStudentNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('female');
  // New enrollments default to the actual school-local today, not the demo dataset's
  // fixed date — otherwise every student created in production is stamped 2025-10-15.
  const [enrollmentDate, setEnrollmentDate] = useState(schoolToday());
  const [yearGroup, setYearGroup] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (open) {
      setStudentNumber(student?.student_number ?? '');
      setFullName(student?.full_name ?? '');
      setDateOfBirth(student?.date_of_birth ?? '');
      setGender(student?.gender ?? 'female');
      setEnrollmentDate(student?.enrollment_date ?? schoolToday());
      setYearGroup(student?.year_group ?? '');
      setClassIds([]);
      setGuardianName(student?.guardian_name ?? '');
      setGuardianPhone(student?.guardian_phone ?? '');
      setGuardianEmail(student?.guardian_email ?? '');
      setAddress(student?.address ?? '');
      setPhone(student?.phone ?? '');
    }
  }, [open, student]);

  const submitDisabled = editing
    ? fullName.trim().length === 0
    : studentNumber.trim().length === 0 ||
      fullName.trim().length === 0 ||
      dateOfBirth.trim().length === 0 ||
      enrollmentDate.trim().length === 0;

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit student' : 'Add student'}
      submitLabel={editing ? 'Save changes' : 'Create student'}
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          student_number: studentNumber.trim(),
          full_name: fullName.trim(),
          date_of_birth: dateOfBirth.trim(),
          gender,
          enrollment_date: enrollmentDate.trim(),
          guardian_name: guardianName.trim(),
          guardian_phone: guardianPhone.trim(),
          guardian_email: guardianEmail.trim(),
          address: address.trim(),
          phone: phone.trim(),
          year_group: yearGroup.trim() || null,
          // Enrollment only applies on create — the API rejects class_ids on PATCH.
          class_ids: editing ? undefined : classIds,
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Student number"
          value={studentNumber}
          onChange={(e) => setStudentNumber(e.target.value)}
          required
          fullWidth
          disabled={editing}
          autoFocus={!editing}
          error={Boolean(fieldErrors?.student_number)}
          helperText={
            fieldErrors?.student_number?.join(' ') ??
            (editing ? 'Student number cannot be changed here.' : undefined)
          }
        />
        <TextField
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          fullWidth
          error={Boolean(fieldErrors?.full_name)}
          helperText={fieldErrors?.full_name?.join(' ')}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Date of birth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            required
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldErrors?.date_of_birth)}
            helperText={fieldErrors?.date_of_birth?.join(' ')}
          />
          <TextField
            select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as 'male' | 'female')}
            fullWidth
          >
            <MenuItem value="female">Female</MenuItem>
            <MenuItem value="male">Male</MenuItem>
          </TextField>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Enrollment date"
            type="date"
            value={enrollmentDate}
            onChange={(e) => setEnrollmentDate(e.target.value)}
            required
            fullWidth
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldErrors?.enrollment_date)}
            helperText={fieldErrors?.enrollment_date?.join(' ')}
          />
          <TextField
            label="Year group"
            value={yearGroup}
            onChange={(e) => setYearGroup(e.target.value)}
            fullWidth
            placeholder="Lower 6"
            error={Boolean(fieldErrors?.year_group)}
            helperText={
              fieldErrors?.year_group?.join(' ') ?? "The student's own level."
            }
          />
        </Stack>
        {!editing && (
          <Autocomplete
            multiple
            options={classOptions}
            value={classOptions.filter((c) => classIds.includes(c.id))}
            onChange={(_e, next) => setClassIds(next.map((c) => c.id))}
            getOptionLabel={(c) => (c.subject_name ? `${c.name} — ${c.subject_name}` : c.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={classesQuery.isLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Subject classes (optional)"
                placeholder={classIds.length === 0 ? 'Enrol now, or later under Classes' : undefined}
                error={Boolean(fieldErrors?.class_ids)}
                helperText={
                  fieldErrors?.class_ids?.join(' ') ??
                  'Pick every class this student will take. You can change this later from a class roster.'
                }
              />
            )}
          />
        )}
        <TextField
          label="Guardian name"
          value={guardianName}
          onChange={(e) => setGuardianName(e.target.value)}
          fullWidth
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Guardian phone"
            value={guardianPhone}
            onChange={(e) => setGuardianPhone(e.target.value)}
            fullWidth
          />
          <TextField
            label="Guardian email"
            type="email"
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
            fullWidth
          />
        </Stack>
        <TextField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          fullWidth
        />
        <TextField
          label="Student phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          fullWidth
        />
      </Stack>
    </FormDialog>
  );
}

export default StudentFormDialog;
