import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { FormDialog } from '@shared/components';
import type { TeacherDetail } from '../types';

/** One editable subject-expertise row in the form. */
export interface TeacherExpertiseRow {
  area: string;
  level: number;
}

/** Values the form emits. `specializations` is a comma-separated field, split on submit. */
export interface TeacherFormValues {
  staff_number: string;
  full_name: string;
  email: string;
  phone: string;
  subject_specializations: string[];
  /** Only meaningful on create: provision a linked login account. */
  create_login: boolean;
  login_email: string;
  // Extended profile fields (edit mode).
  bio: string;
  gender: '' | 'male' | 'female' | 'other';
  education: string;
  designation: string;
  address: string;
  expertise: TeacherExpertiseRow[];
}

export interface TeacherFormDialogProps {
  open: boolean;
  /** Edit mode when provided (create otherwise). */
  teacher?: TeacherDetail | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: TeacherFormValues) => void;
  onClose: () => void;
}

/**
 * Create / edit a teacher (api-spec §5.4). On create, an optional "Create login account"
 * toggle provisions a linked teacher login — the server then returns a one-time
 * temporary password the parent surfaces via TempPasswordDialog. On edit, the staff
 * number is immutable and login provisioning is unavailable (managed under Settings ›
 * Users), and the extended profile fields (bio, gender, education, designation, address,
 * subject-expertise bars) become editable. A 409 duplicate_staff_number / duplicate_email
 * is surfaced by the parent.
 *
 * Scope: profile fields only — staff number, status and login are managed elsewhere and
 * are intentionally not editable here.
 */
export function TeacherFormDialog({
  open,
  teacher,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: TeacherFormDialogProps) {
  const editing = Boolean(teacher);
  const [staffNumber, setStaffNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [specializations, setSpecializations] = useState('');
  const [createLogin, setCreateLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [bio, setBio] = useState('');
  const [gender, setGender] = useState<TeacherFormValues['gender']>('');
  const [education, setEducation] = useState('');
  const [designation, setDesignation] = useState('');
  const [address, setAddress] = useState('');
  const [expertise, setExpertise] = useState<TeacherExpertiseRow[]>([]);

  useEffect(() => {
    if (open) {
      setStaffNumber(teacher?.staff_number ?? '');
      setFullName(teacher?.full_name ?? '');
      setEmail(teacher?.email ?? '');
      setPhone(teacher?.phone ?? '');
      setSpecializations((teacher?.subject_specializations ?? []).join(', '));
      setCreateLogin(false);
      setLoginEmail('');
      setBio(teacher?.bio ?? '');
      setGender(teacher?.gender ?? '');
      setEducation(teacher?.education ?? '');
      setDesignation(teacher?.designation ?? '');
      setAddress(teacher?.address ?? '');
      setExpertise((teacher?.expertise ?? []).map((e) => ({ area: e.area, level: e.level })));
    }
  }, [open, teacher]);

  const parseSpecs = (raw: string): string[] =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const addExpertise = () => setExpertise((rows) => [...rows, { area: '', level: 70 }]);
  const removeExpertise = (index: number) =>
    setExpertise((rows) => rows.filter((_, i) => i !== index));
  const setExpertiseArea = (index: number, area: string) =>
    setExpertise((rows) => rows.map((r, i) => (i === index ? { ...r, area } : r)));
  const setExpertiseLevel = (index: number, level: number) =>
    setExpertise((rows) => rows.map((r, i) => (i === index ? { ...r, level } : r)));

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit teacher' : 'Add teacher'}
      submitLabel={editing ? 'Save changes' : 'Create teacher'}
      submitting={submitting}
      submitDisabled={
        editing
          ? fullName.trim().length === 0
          : staffNumber.trim().length === 0 ||
            fullName.trim().length === 0 ||
            (createLogin && loginEmail.trim().length === 0)
      }
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          staff_number: staffNumber.trim(),
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          subject_specializations: parseSpecs(specializations),
          create_login: !editing && createLogin,
          login_email: loginEmail.trim(),
          bio: bio.trim(),
          gender,
          education: education.trim(),
          designation: designation.trim(),
          address: address.trim(),
          expertise: expertise
            .map((e) => ({ area: e.area.trim(), level: Math.max(0, Math.min(100, e.level)) }))
            .filter((e) => e.area.length > 0),
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Staff number"
          value={staffNumber}
          onChange={(e) => setStaffNumber(e.target.value)}
          required
          fullWidth
          disabled={editing}
          autoFocus={!editing}
          error={Boolean(fieldErrors?.staff_number)}
          helperText={
            fieldErrors?.staff_number?.join(' ') ??
            (editing ? 'Staff number cannot be changed here.' : undefined)
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
        <TextField
          label="Email (optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          error={Boolean(fieldErrors?.email)}
          helperText={fieldErrors?.email?.join(' ')}
        />
        <TextField
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          fullWidth
        />
        <TextField
          label="Course specializations"
          value={specializations}
          onChange={(e) => setSpecializations(e.target.value)}
          fullWidth
          helperText="Comma-separated, e.g. Mathematics, Physics."
        />

        {!editing && (
          <>
            <FormControlLabel
              control={
                <Switch checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} />
              }
              label="Create login account"
            />
            {createLogin && (
              <TextField
                label="Login email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                fullWidth
                helperText="A temporary password will be generated and shown once."
              />
            )}
          </>
        )}

        {editing && (
          <>
            <Divider textAlign="left">
              <Typography variant="overline" color="text.secondary">
                Profile
              </Typography>
            </Divider>

            <TextField
              label="Designation (optional)"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              fullWidth
              helperText="e.g. Senior Lecturer, Head of Department."
            />
            <TextField
              label="Education (optional)"
              value={education}
              onChange={(e) => setEducation(e.target.value)}
              fullWidth
              helperText="e.g. M.Ed. Mathematics."
            />
            <TextField
              label="Gender (optional)"
              select
              value={gender}
              onChange={(e) => setGender(e.target.value as TeacherFormValues['gender'])}
              fullWidth
            >
              <MenuItem value="">Not specified</MenuItem>
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </TextField>
            <TextField
              label="Bio (optional)"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="A short professional summary."
            />
            <TextField
              label="Address (optional)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />

            <Box>
              <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
                Subject expertise
              </Typography>
              <Stack spacing={2}>
                {expertise.map((row, index) => (
                  <Stack
                    key={index}
                    direction="row"
                    spacing={2}
                    sx={{ alignItems: 'center' }}
                  >
                    <TextField
                      label="Area"
                      value={row.area}
                      onChange={(e) => setExpertiseArea(index, e.target.value)}
                      size="small"
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                    <Box sx={{ width: 140, flexShrink: 0 }}>
                      <Slider
                        value={row.level}
                        min={0}
                        max={100}
                        valueLabelDisplay="auto"
                        onChange={(_, value) =>
                          setExpertiseLevel(index, Array.isArray(value) ? value[0]! : value)
                        }
                        aria-label={`${row.area || 'Expertise'} level`}
                      />
                    </Box>
                    <IconButton
                      aria-label={`Remove ${row.area || 'expertise area'}`}
                      onClick={() => removeExpertise(index)}
                      size="small"
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                <Button
                  startIcon={<AddIcon />}
                  onClick={addExpertise}
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Add expertise area
                </Button>
              </Stack>
            </Box>
          </>
        )}
      </Stack>
    </FormDialog>
  );
}

export default TeacherFormDialog;
