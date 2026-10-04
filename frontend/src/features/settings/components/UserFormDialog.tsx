import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField, FormControlLabel, Switch } from '@mui/material';
import { FormDialog, PasswordField } from '@shared/components';
import { Role } from '@shared/api/generated/model';
import type { UserListItem } from '@shared/api/generated/model';
// D30: role options (and their Dean/Registrar/Lecturer labels) come from the one
// shared source; this file used to carry its own copy.
import { ROLE_OPTIONS } from '@shared/auth/roleLabels';

export interface UserFormValues {
  email: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  temporary_password: string;
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

  useEffect(() => {
    if (open) {
      setEmail(user?.email ?? '');
      setUsername(user?.username ?? '');
      setFullName(user?.full_name ?? '');
      setRole(user?.role ?? Role.teacher);
      setIsActive(user?.is_active ?? true);
      setTempPassword('');
    }
  }, [open, user]);

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit user' : 'Add user'}
      submitLabel={editing ? 'Save changes' : 'Create user'}
      submitting={submitting}
      submitDisabled={
        editing
          ? fullName.trim().length === 0
          : email.trim().length === 0 || fullName.trim().length === 0
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
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          fullWidth
          disabled={editing}
          autoFocus={!editing}
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
        <TextField
          select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
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
