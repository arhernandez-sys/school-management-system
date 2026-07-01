import { Alert, Box } from '@mui/material';
import { PageHeader } from './PageHeader';
import { capabilityFor, type ModuleKey } from '@shared/auth/permissions';
import { useAuth } from '@features/auth/hooks/useAuth';

export interface ModulePlaceholderProps {
  module: ModuleKey;
  title: string;
}

/**
 * Phase 6 placeholder for a feature module. Demonstrates the standard page template
 * (PageHeader + content region) and renders the caller's role + capability so the
 * role-aware navigation and guards are visibly working end-to-end. Phase 7 replaces
 * each module's routes with real list/detail/form pages.
 */
export function ModulePlaceholder({ module, title }: ModulePlaceholderProps) {
  const { user } = useAuth();
  const capability = user ? capabilityFor(user.role, module) : 'none';

  return (
    <Box>
      <PageHeader
        title={title}
        subtitle={user ? `Signed in as ${user.role} · capability: ${capability}` : undefined}
      />
      <Alert severity="info" variant="outlined">
        This is the <strong>{title}</strong> module placeholder. Real functionality lands in
        Phase 7. Navigation, the role-aware shell, and route guards are functional now.
      </Alert>
    </Box>
  );
}

export default ModulePlaceholder;
