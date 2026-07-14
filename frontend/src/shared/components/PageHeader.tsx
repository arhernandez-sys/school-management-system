import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Single primary action (top-right), role-gated by the caller. */
  primaryAction?: ReactNode;
  /** Secondary actions rendered left of the primary. */
  secondaryActions?: ReactNode;
  /**
   * Optional breadcrumb trail (e.g. an MUI `<Breadcrumbs>`), rendered in the header's
   * right area, visually lighter than the title. When actions are also present the
   * breadcrumbs sit above them; on `xs` the whole right column stacks under the title.
   */
  breadcrumbs?: ReactNode;
}

/**
 * Standard page title block (design-system §4.3, §5 #6). The h2 title is the
 * route-change focus target for accessibility (§9.3); callers may forward a ref/id.
 */
export function PageHeader({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  breadcrumbs,
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);
  return (
    <Box sx={{ mb: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" component="h1" tabIndex={-1} id="page-title">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {(breadcrumbs || hasActions) && (
          <Stack
            spacing={1}
            sx={{ flexShrink: 0, alignItems: { xs: 'flex-start', sm: 'flex-end' } }}
          >
            {breadcrumbs && (
              <Box sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{breadcrumbs}</Box>
            )}
            {hasActions && (
              <Stack direction="row" spacing={1}>
                {secondaryActions}
                {primaryAction}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

export default PageHeader;
