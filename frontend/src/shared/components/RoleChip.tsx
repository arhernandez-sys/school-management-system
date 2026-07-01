import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';
import type { Role } from '@shared/api/generated/model';

/**
 * RoleChip — consistent role display (design-system §5 #11).
 *
 * Promoted from the Phase-6 stub for the Users-admin screen (Settings 7.2). Maps the
 * generated `Role` enum to a human label + a stable color so a user's role reads the
 * same in the directory, detail, and create/edit surfaces.
 */
const ROLE_LABEL: Record<Role, string> = {
  principal: 'Principal',
  secretary: 'Secretary',
  teacher: 'Teacher',
  student: 'Student',
};

const ROLE_COLOR: Record<Role, ChipProps['color']> = {
  principal: 'primary',
  secretary: 'secondary',
  teacher: 'info',
  student: 'default',
};

export interface RoleChipProps {
  role: Role;
  size?: ChipProps['size'];
}

export function RoleChip({ role, size = 'small' }: RoleChipProps) {
  return <Chip label={ROLE_LABEL[role]} color={ROLE_COLOR[role]} size={size} />;
}

export default RoleChip;
