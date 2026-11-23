import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField, FormControlLabel, Switch } from '@mui/material';
import { FormDialog, PasswordField } from '@shared/components';
import { SearchableSelect } from '@shared/components/SearchableSelect';
import { useDebounce } from '@shared/hooks/useDebounce';
import { Role } from '@shared/api/generated/model';
import type { UserListItem } from '@shared/api/generated/model';
// D30: role options (and their Dean/Registrar/Lecturer labels) come from the one
// shared source; this file used to carry its own copy.
import { ROLE_OPTIONS } from '@shared/auth/roleLabels';
import { PROFILE_KIND_BY_ROLE, useLinkableProfiles } from '../hooks/useSettings';

export interface UserFormValues {
  email: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  temporary_password: string;
  /** The lecturer/student profile the login belongs to; '' for roles that take none. */
  profile_id: string;
}

export interface UserFormDialogProps {
  open: boolean;
  /** Edit mode when provided. */
  user?: UserListItem | null;
  /** Only a principal may set/change role or is_active (server enforces; UX mirrors). */
  canManagePrivileges: boolean;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: UserFormValues) => void;
  onClose: () => void;
}

/**
 * Create / edit a user account (api-spec §11). On create, the admin may optionally
 * supply a temporary password (otherwise the server generates one, returned once). On
 * edit, email is immutable here and role/is_active are only editable with privileges;
 * a 403 role_change_forbidden or 409 duplicate_email is surfaced by the parent.
 *
 * A Student, Lecturer or HOD login must be linked to the profile it belongs to, picked
 * from the profiles that have no login yet. Without that link the login has no students,
 * offerings or record of its own and every scoped screen 404s. The other roles (Dean,
 * Registrar, Auditor, System admin) work on the role alone and show no picker.
 *
 * Edit shows the same picker, starting on the profile the login holds now, so a login
 * can be re-pointed at another person or linked for the first time. Changing it releases
 * the old profile (server side).
 */
export function UserFormDialog({
  open,
  user,
  canManagePrivileges,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: UserFormDialogProps) {
  const editing = Boolean(user);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>(Role.teacher);
  const [isActive, setIsActive] = useState(true);
  const [tempPassword, setTempPassword] = useState('');
  const [profileId, setProfileId] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const debouncedSearch = useDebounce(profileSearch);

  const profileKind = PROFILE_KIND_BY_ROLE[role];
  const needsProfile = Boolean(profileKind);
  // The profile the login holds now, when it is the kind `forRole` needs. Lecturer <->
  // HOD keeps it; a move to Student does not.
  const currentLinkFor = (forRole: Role) => {
    const link = user?.linked_profile;
    return link && link.kind === PROFILE_KIND_BY_ROLE[forRole] ? link : null;
  };
  const currentLink = currentLinkFor(role);
  // On create a profiled role always needs one; on edit only when the role is changing
  // into it, so renaming a legacy unlinked login is not blocked (the server agrees).
  const profileRequired = needsProfile && (!editing || role !== user?.role);
  const profilesQuery = useLinkableProfiles(role, debouncedSearch, open && needsProfile);
  // The picker lists only profiles with NO login, which excludes this login's own;
  // add it back so the current link shows as the selected value.
  const unlinked = profilesQuery.data ?? [];
  const profiles =
    currentLink && !unlinked.some((p) => p.id === currentLink.id)
      ? [{ ...currentLink, email: currentLink.email ?? null }, ...unlinked]
      : unlinked;
  const profileNoun = profileKind === 'student' ? 'student' : 'lecturer';

  const pickProfile = (id: string) => {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    // The login is for this person, so start from their record. Still editable: the
    // login email can differ from the contact email on the profile.
    setFullName(p.full_name);
    if (!editing && !email.trim() && p.email) setEmail(p.email);
  };

  useEffect(() => {
    if (open) {
      setEmail(user?.email ?? '');
      setUsername(user?.username ?? '');
      setFullName(user?.full_name ?? '');
      setRole(user?.role ?? Role.teacher);
      setIsActive(user?.is_active ?? true);
      setTempPassword('');
      const link = user?.linked_profile;
      setProfileId(user && link && link.kind === PROFILE_KIND_BY_ROLE[user.role] ? link.id : '');
      setProfileSearch('');
    }
  }, [open, user]);

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit user' : 'Add user'}
      submitLabel={editing ? 'Save changes' : 'Create user'}
      submitting={submitting}
      submitDisabled={
        fullName.trim().length === 0 ||
        (!editing && email.trim().length === 0) ||
        (profileRequired && !profileId)
      }
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          email: email.trim(),
          username: username.trim(),
          full_name: fullName.trim(),
          role,
          is_active: isActive,
          temporary_password: tempPassword,
          profile_id: needsProfile ? profileId : '',
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          select
          label="Role"
          value={role}
          onChange={(e) => {
            const next = e.target.value as Role;
            setRole(next);
            // A lecturer profile is not a student's, so a role change starts over -
            // unless the login already holds the kind the new role needs.
            setProfileId(currentLinkFor(next)?.id ?? '');
            setProfileSearch('');
          }}
          fullWidth
          disabled={!canManagePrivileges}
          helperText={!canManagePrivileges ? 'Only a principal can set a user’s role.' : undefined}
        >
          {ROLE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

        {needsProfile && (
          <SearchableSelect
            label={`Link to ${profileNoun}`}
            value={profileId}
            onChange={pickProfile}
            onInputChange={setProfileSearch}
            options={profiles.map((p) => ({
              value: p.id,
              label: p.full_name,
              hint: p.number,
            }))}
            loading={profilesQuery.isFetching}
            required={profileRequired}
            fullWidth
            size="medium"
            noOptionsText={`No ${profileNoun} without a login matches. Create the ${profileNoun} first.`}
            error={Boolean(fieldErrors?.profile_id)}
            helperText={
              fieldErrors?.profile_id?.join(' ') ??
              (editing && !profileId
                ? `This login is not linked to a ${profileNoun}, so it sees no records of its own. `
                : '') +
                `Search by name or ${profileKind === 'student' ? 'student' : 'staff'} number. Only ${profileNoun}s who have no login yet are listed.`
            }
          />
        )}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          fullWidth
          disabled={editing}
          error={Boolean(fieldErrors?.email)}
          helperText={
            fieldErrors?.email?.join(' ') ?? (editing ? 'Email cannot be changed here.' : undefined)
          }
        />
        <TextField
          label="Username (optional)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          fullWidth
          error={Boolean(fieldErrors?.username)}
          helperText={fieldErrors?.username?.join(' ')}
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

        {editing && (
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={!canManagePrivileges}
              />
            }
            label="Active"
          />
        )}

        {!editing && (
          <PasswordField
            label="Temporary password (optional)"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            fullWidth
            helperText="Leave blank to have one generated and shown once after creation."
          />
        )}
      </Stack>
    </FormDialog>
  );
}

export default UserFormDialog;
