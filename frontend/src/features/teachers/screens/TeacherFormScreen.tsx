import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { ErrorState, LoadingState, PageContainer, PageHeader, DateField } from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { TempPasswordDialog } from '@features/settings/components/TempPasswordDialog';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import {
  useCreateTeacher,
  useTeacherDetail,
  useUpdateTeacher,
} from '../hooks/useTeachers';
import type { TeacherDetail } from '../types';

/**
 * Add / edit a lecturer as a FULL-PAGE FORM (D40, client ask) — the shape the admissions
 * application form already has, applied to the one other record the school types from
 * scratch.
 *
 * **Why this replaced `TeacherFormDialog`.** The dialog had two problems, and they
 * compounded:
 *
 *  * **Create showed six fields; edit showed twenty.** Everything under *Profile* and
 *    *Employment* was gated behind `editing`, so adding a lecturer captured a staff
 *    number, a name and a phone number, and the Dean then had to reopen the record they
 *    had just made to enter the hire date, licence number and qualification they were
 *    holding in their hand. The POST body could not carry them either (D40 adds `gender`,
 *    `bio` and `expertise` to `TeacherCreateRequest`), so this is not a UI-only change.
 *  * **Twenty fields do not fit in a modal.** They scrolled inside a `sm` dialog with the
 *    actions pinned below, which is the layout an application form is deliberately not
 *    given.
 *
 * **One screen, both modes**, chosen by the route:
 *
 *     /teachers/new         POST /teachers   (+ optional linked login)
 *     /teachers/:id/edit    PATCH /teachers/{id}
 *
 * Create and edit share every field for the reason the wizard shares its three modes: two
 * forms writing the same columns drift, and the last time they did, the thing that drifted
 * was which fields existed at all.
 *
 * **Sections, not steps.** The application form is seven steps because it is seven
 * numbered sections of a legal document filled in over a sitting. A lecturer is one
 * person's staff record — around twenty fields — and splitting it would add four clicks
 * and a Back button to a form that fits on a page. The Dividers do the same work the
 * Stepper does: they say what this part of the form is about.
 *
 * **Saved once, at the bottom.** Same as D38's rule for the application: nothing is
 * written until the Dean asks for it, so an abandoned form leaves nothing behind.
 */

/** One editable subject-expertise row. `level` is a 0–100 percentage the profile bars read. */
interface ExpertiseRow {
  area: string;
  level: number;
}

/**
 * Local editing shape — every field a string, so a partially-typed form is representable
 * (the wizard's `Draft` does the same, for the same reason).
 *
 * `status` is deliberately absent. Employment IS `status`, it is changed from the lecturer
 * list through its own audited endpoint, and a second control writing the same fact here
 * would let the two disagree — the note `TeacherFormDialog` carried about `is_employed`,
 * which is derived from it server-side.
 */
interface Draft {
  staff_number: string;
  full_name: string;
  first_name: string;
  last_name: string;
  gender: '' | 'male' | 'female' | 'other';
  email: string;
  phone: string;
  address: string;
  ssno: string;
  licensenum: string;
  hire_date: string;
  end_date: string;
  designation: string;
  academic_qualification: string;
  specializations: string;
  bio: string;
  comments: string;
  expertise: ExpertiseRow[];
  create_login: boolean;
  login_email: string;
}

const EMPTY: Draft = {
  staff_number: '',
  full_name: '',
  first_name: '',
  last_name: '',
  gender: '',
  email: '',
  phone: '',
  address: '',
  ssno: '',
  licensenum: '',
  hire_date: '',
  end_date: '',
  designation: '',
  academic_qualification: '',
  specializations: '',
  bio: '',
  comments: '',
  expertise: [],
  create_login: false,
  login_email: '',
};

/** Server record → editing shape. */
function fromDetail(t: TeacherDetail): Draft {
  return {
    staff_number: t.staff_number ?? '',
    full_name: t.full_name ?? '',
    first_name: t.first_name ?? '',
    last_name: t.last_name ?? '',
    gender: t.gender ?? '',
    email: t.email ?? '',
    phone: t.phone ?? '',
    address: t.address ?? '',
    ssno: t.ssno ?? '',
    licensenum: t.licensenum ?? '',
    hire_date: t.hire_date ?? '',
    end_date: t.end_date ?? '',
    designation: t.designation ?? '',
    academic_qualification: t.academic_qualification ?? '',
    specializations: (t.subject_specializations ?? []).join(', '),
    bio: t.bio ?? '',
    comments: t.comments ?? '',
    expertise: (t.expertise ?? []).map((e) => ({ area: e.area, level: e.level })),
    // Login provisioning is a create-only affordance; on an existing lecturer the account
    // is managed under Settings › Users.
    create_login: false,
    login_email: '',
  };
}

/** Comma-separated → the array the API takes. Blank entries dropped. */
const parseSpecs = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** `''` → `undefined`, so an untouched optional field is OMITTED rather than sent blank. */
const orUndef = (value: string) => {
  const v = value.trim();
  return v === '' ? undefined : v;
};

/** A labelled rule, rendered like the wizard's section Dividers. */
function SectionHeading({ children }: { children: string }) {
  return (
    <Divider textAlign="left" sx={{ pt: 1 }}>
      <Typography variant="overline" color="text.secondary">
        {children}
      </Typography>
    </Divider>
  );
}

/** One responsive row of fields — column on a phone, side by side from `sm` up. */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      {children}
    </Stack>
  );
}

export function TeacherFormScreen() {
  const navigate = useNavigate();
  const { teacherId } = useParams<{ teacherId: string }>();
  const editing = Boolean(teacherId);
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'teachers') : false;

  const detailQuery = useTeacherDetail(teacherId);
  const createMut = useCreateTeacher();
  const updateMut = useUpdateTeacher(teacherId ?? '');

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const detail = detailQuery.data;
  // Re-seed whenever the record arrives (or changes underneath an open form).
  useEffect(() => {
    if (detail) setDraft(fromDetail(detail));
  }, [detail]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const err = (field: string) => fieldErrors[field]?.join(' ');

  const addExpertise = () =>
    setDraft((prev) => ({ ...prev, expertise: [...prev.expertise, { area: '', level: 70 }] }));
  const removeExpertise = (index: number) =>
    setDraft((prev) => ({
      ...prev,
      expertise: prev.expertise.filter((_, i) => i !== index),
    }));
  const patchExpertise = (index: number, patch: Partial<ExpertiseRow>) =>
    setDraft((prev) => ({
      ...prev,
      expertise: prev.expertise.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));

  const expertisePayload = useMemo(
    () =>
      draft.expertise
        .map((e) => ({ area: e.area.trim(), level: Math.max(0, Math.min(100, e.level)) }))
        .filter((e) => e.area.length > 0),
    [draft.expertise],
  );

  /**
   * What the save requires, spelled out once so the disabled button and the tooltip that
   * explains it cannot disagree.
   *
   * `gender` is required on EDIT only, which is not an inconsistency: the column is
   * nullable and every lecturer created before the profile section existed holds NULL, so
   * demanding it on create would be stricter than the records already on file — but a Dean
   * who has opened one to edit it should finish it. That is the rule
   * `TeacherFormDialog` enforced, kept.
   */
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!editing && draft.staff_number.trim().length === 0) out.push('a staff number');
    if (draft.full_name.trim().length === 0) out.push('a full name');
    if (editing && draft.gender.length === 0) out.push('a gender');
    if (!editing && draft.create_login && draft.login_email.trim().length === 0) {
      out.push('a login email');
    }
    return out;
  }, [editing, draft.staff_number, draft.full_name, draft.gender, draft.create_login, draft.login_email]);

  const saving = createMut.isPending || updateMut.isPending;
  const incompleteHint =
    missing.length > 0 ? `Still needed: ${missing.join(', ')}.` : '';

  const onError = (e: unknown) => {
    setError(apiErrorMessage(e));
    setFieldErrors(fieldErrorsFrom(e) ?? {});
  };

  const save = () => {
    setError(null);
    setFieldErrors({});

    if (editing) {
      updateMut.mutate(
        {
          full_name: draft.full_name.trim(),
          // `null` CLEARS on these two; the rest use `''` for the same effect, matching
          // how the API already behaved for the dialog.
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          subject_specializations: parseSpecs(draft.specializations),
          first_name: orUndef(draft.first_name),
          last_name: orUndef(draft.last_name),
          gender: draft.gender || undefined,
          bio: orUndef(draft.bio),
          academic_qualification: orUndef(draft.academic_qualification),
          designation: orUndef(draft.designation),
          address: orUndef(draft.address),
          ssno: orUndef(draft.ssno),
          licensenum: orUndef(draft.licensenum),
          hire_date: draft.hire_date || undefined,
          end_date: draft.end_date || undefined,
          comments: orUndef(draft.comments),
          expertise: expertisePayload,
        },
        {
          onSuccess: () => navigate(`${ROUTES.teachers}/${teacherId}`),
          onError,
        },
      );
      return;
    }

    createMut.mutate(
      {
        staff_number: draft.staff_number.trim(),
        full_name: draft.full_name.trim(),
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        subject_specializations: parseSpecs(draft.specializations),
        create_login: draft.create_login
          ? { email: draft.login_email.trim(), role: 'teacher' as const }
          : null,
        // D40 — create now carries the WHOLE profile. Every one of these was edit-only
        // before, which meant the Dean entered them twice or not at all.
        first_name: orUndef(draft.first_name),
        last_name: orUndef(draft.last_name),
        gender: draft.gender || undefined,
        bio: orUndef(draft.bio),
        academic_qualification: orUndef(draft.academic_qualification),
        designation: orUndef(draft.designation),
        address: orUndef(draft.address),
        ssno: orUndef(draft.ssno),
        licensenum: orUndef(draft.licensenum),
        hire_date: draft.hire_date || undefined,
        end_date: draft.end_date || undefined,
        comments: orUndef(draft.comments),
        expertise: expertisePayload,
      },
      {
        onSuccess: (result) => {
          // A provisioned login's temporary password is shown ONCE and never again, so
          // navigating away first would destroy it. The dialog's Close is what leaves.
          if (result.temporary_password) {
            setTempPassword(result.temporary_password);
            return;
          }
          navigate(`${ROUTES.teachers}/${result.teacher.id}`);
        },
        onError,
      },
    );
  };

  const leave = () =>
    navigate(editing && teacherId ? `${ROUTES.teachers}/${teacherId}` : ROUTES.teachers);

  if (!canManage) {
    return (
      <PageContainer>
        <ErrorState
          title="You cannot edit lecturers"
          message="Ask a principal or secretary to make this change."
          onRetry={() => navigate(ROUTES.teachers)}
        />
      </PageContainer>
    );
  }
  if (editing && detailQuery.isLoading) return <LoadingState variant="form" />;
  if (editing && detailQuery.isError) {
    return (
      <PageContainer>
        <ErrorState onRetry={() => void detailQuery.refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={leave}
        sx={{ mb: 1, alignSelf: 'flex-start' }}
      >
        {editing ? 'Back to profile' : 'All lecturers'}
      </Button>

      <PageHeader
        title={editing ? 'Edit lecturer' : 'Add lecturer'}
        subtitle={
          editing
            ? 'The full staff record. Nothing is saved until you press Save changes.'
            : 'The full staff record, on one page. Nothing is saved until you press Create lecturer.'
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          <AlertTitle>Could not save this lecturer</AlertTitle>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <SectionHeading>Identity</SectionHeading>
          <Row>
            <TextField
              label="Staff number"
              value={draft.staff_number}
              onChange={(e) => set('staff_number', e.target.value)}
              required
              fullWidth
              disabled={editing}
              autoFocus={!editing}
              error={Boolean(fieldErrors.staff_number)}
              helperText={
                err('staff_number') ?? (editing ? 'Staff number cannot be changed here.' : undefined)
              }
            />
            <TextField
              label="Full name"
              value={draft.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              required
              fullWidth
              autoFocus={editing}
              error={Boolean(fieldErrors.full_name)}
              helperText={err('full_name') ?? 'The name shown everywhere in the system.'}
            />
          </Row>
          <Row>
            {/* D39 — additive to `full_name`, not a replacement for it: the client's
                reports want the parts, and the display value stays the authority for
                every screen that prints a name. */}
            <TextField
              label="First name (optional)"
              value={draft.first_name}
              onChange={(e) => set('first_name', e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.first_name)}
              helperText={err('first_name')}
            />
            <TextField
              label="Last name (optional)"
              value={draft.last_name}
              onChange={(e) => set('last_name', e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.last_name)}
              helperText={err('last_name')}
            />
            <TextField
              label="Gender"
              select
              value={draft.gender}
              onChange={(e) => set('gender', e.target.value as Draft['gender'])}
              required={editing}
              fullWidth
              error={Boolean(fieldErrors.gender)}
              helperText={
                err('gender') ??
                (editing && !draft.gender
                  ? 'Required — choose one to save this profile.'
                  : undefined)
              }
            >
              {/* `teacher_profiles.gender` is a real MariaDB enum, unlike the student's —
                  the column was created with no legacy data behind it, so these three are
                  the whole vocabulary and there is no "(as recorded)" case to carry.

                  No blank row: on edit the field is required, and an option that submits
                  an empty value would defeat that from inside the control. A lecturer
                  with nothing on file simply opens blank. */}
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </TextField>
          </Row>

          <SectionHeading>Contact</SectionHeading>
          <Row>
            <TextField
              label="Email (optional)"
              type="email"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.email)}
              helperText={
                err('email') ??
                // Spelled out because the form below can also ask for an email and they
                // are not the same thing.
                'A contact address. It is not a login.'
              }
            />
            <TextField
              label="Phone (optional)"
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
              fullWidth
            />
          </Row>
          <TextField
            label="Address (optional)"
            value={draft.address}
            onChange={(e) => set('address', e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />

          <SectionHeading>Employment</SectionHeading>
          {/* D39, Meeting #2 item 10. There is deliberately no "Employed" switch:
              employment IS `status`, which is changed from the lecturer list so that
              deactivating someone stays one audited action, and `is_employed` is derived
              from it server-side. A second control writing the same fact would let the
              two disagree. */}
          <Row>
            <TextField
              label="Social security no. (optional)"
              value={draft.ssno}
              onChange={(e) => set('ssno', e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 9 } }}
              error={Boolean(fieldErrors.ssno)}
              helperText={err('ssno') ?? 'Up to 9 characters.'}
            />
            <TextField
              label="Teacher licence no. (optional)"
              value={draft.licensenum}
              onChange={(e) => set('licensenum', e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 15 } }}
              error={Boolean(fieldErrors.licensenum)}
              helperText={
                err('licensenum') ??
                // Spelled out because it looks like a number and is not: the Ministry's
                // format is letters, digits and hyphens.
                'Letters, digits and hyphens — e.g. OWD-2019-00035.'
              }
            />
          </Row>
          <Row>
            <DateField
              label="Hire date (optional)"
              value={draft.hire_date}
              onChange={(v) => set('hire_date', v)}
              fullWidth
              error={Boolean(fieldErrors.hire_date)}
              helperText={err('hire_date')}
            />
            <DateField
              label="End date (optional)"
              value={draft.end_date}
              onChange={(v) => set('end_date', v)}
              fullWidth
              error={Boolean(fieldErrors.end_date)}
              helperText={err('end_date') ?? 'Leave blank while employed.'}
            />
          </Row>
          <Row>
            <TextField
              label="Designation (optional)"
              value={draft.designation}
              onChange={(e) => set('designation', e.target.value)}
              fullWidth
              helperText="e.g. Senior Lecturer, Head of Department."
            />
            <TextField
              label="Academic qualification (optional)"
              value={draft.academic_qualification}
              onChange={(e) => set('academic_qualification', e.target.value)}
              fullWidth
              helperText="e.g. M.Ed. Mathematics."
            />
          </Row>

          <SectionHeading>Profile</SectionHeading>
          <TextField
            label="Course specializations"
            value={draft.specializations}
            onChange={(e) => set('specializations', e.target.value)}
            fullWidth
            helperText="Comma-separated, e.g. Mathematics, Physics."
          />
          <TextField
            label="Bio (optional)"
            value={draft.bio}
            onChange={(e) => set('bio', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="A short professional summary. Shown on the lecturer's profile."
          />
          <TextField
            label="Comments (optional)"
            value={draft.comments}
            onChange={(e) => set('comments', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 500 } }}
            error={Boolean(fieldErrors.comments)}
            helperText={err('comments') ?? 'Internal staff note. Not shown to students.'}
          />

          <SectionHeading>Subject expertise</SectionHeading>
          <Typography variant="body2" color="text.secondary">
            Rated areas, drawn as labelled bars on the profile. Optional — add none and the
            section simply does not appear.
          </Typography>
          <Stack spacing={2}>
            {draft.expertise.map((row, index) => (
              <Stack key={index} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Area"
                  value={row.area}
                  onChange={(e) => patchExpertise(index, { area: e.target.value })}
                  size="small"
                  sx={{ flex: 1, minWidth: 0 }}
                />
                <Box sx={{ width: { xs: 110, sm: 160 }, flexShrink: 0 }}>
                  <Slider
                    value={row.level}
                    min={0}
                    max={100}
                    valueLabelDisplay="auto"
                    onChange={(_, value) =>
                      patchExpertise(index, {
                        level: Array.isArray(value) ? (value[0] ?? 0) : value,
                      })
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

          {/* Create only. On an existing lecturer the linked account is managed under
              Settings › Users, which is also where it can be reset — provisioning a
              second one from here would be a way to end up with two. */}
          {!editing && (
            <>
              <SectionHeading>Login</SectionHeading>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.create_login}
                    onChange={(e) => set('create_login', e.target.checked)}
                  />
                }
                label="Create login account"
              />
              {draft.create_login && (
                <TextField
                  label="Login email"
                  type="email"
                  value={draft.login_email}
                  onChange={(e) => set('login_email', e.target.value)}
                  required
                  fullWidth
                  error={Boolean(fieldErrors.create_login)}
                  helperText={
                    err('create_login') ??
                    'A temporary password will be generated and shown once.'
                  }
                />
              )}
            </>
          )}
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
        <Button onClick={leave} disabled={saving}>
          Cancel
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {saving && <CircularProgress size={18} />}
        <Tooltip title={incompleteHint}>
          {/* The span is what makes the tooltip reachable — a disabled button fires no
              pointer events, so without it the explanation for why it is disabled is
              itself unreachable. */}
          <span>
            <Button
              variant="contained"
              onClick={save}
              disabled={saving || missing.length > 0}
            >
              {editing ? 'Save changes' : 'Create lecturer'}
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <TempPasswordDialog
        open={Boolean(tempPassword)}
        password={tempPassword}
        subject={draft.full_name.trim() || undefined}
        onClose={() => {
          setTempPassword(null);
          navigate(ROUTES.teachers);
        }}
      />
    </PageContainer>
  );
}

export default TeacherFormScreen;
