import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import { DEMO_TODAY } from '@shared/api/mocks/demo/dataset';
import type { StudentDetail, StudentWritePayload } from '../types';
import { useSectionOptions } from '../hooks/useSections';

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
 * Create / edit a student (api-spec §5.3). Create requires student number, full name,
 * date of birth, and enrollment date; a section may be chosen to enroll on create. On
 * edit the section is not changed here (enrollment moves live under Classes). A 409
 * duplicate_student_number is surfaced by the parent.
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
  const sectionsQuery = useSectionOptions();

  const [studentNumber, setStudentNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('female');
  const [enrollmentDate, setEnrollmentDate] = useState(DEMO_TODAY);
  const [sectionId, setSectionId] = useState('');
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
      setEnrollmentDate(student?.enrollment_date ?? DEMO_TODAY);
      setSectionId(student?.current_section?.id ?? '');
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
          // Section only applies on create (enrollment moves live under Classes).
          section_id: editing ? undefined : sectionId || null,
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
          {!editing && (
            <TextField
              select
              label="Section (optional)"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              fullWidth
              disabled={sectionsQuery.isLoading}
              helperText="Enroll the student into a section now, or later under Classes."
            >
              <MenuItem value="">No section yet</MenuItem>
              {(sectionsQuery.data ?? []).map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
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
