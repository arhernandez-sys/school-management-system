import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { PageHeader } from './PageHeader';

export interface ProfileLayoutProps {
  /** Page heading — becomes the `<h1>` route-focus target inside PageHeader. */
  title: string;
  /** Optional breadcrumb trail, rendered lighter in the header's right area. */
  breadcrumbs?: ReactNode;
  /** Header actions (edit / activate / delete …), role-gated by the caller. */
  actions?: ReactNode;
  /** Left column — a compact summary card (identity, key facts). Shown first on `xs`. */
  summary: ReactNode;
  /** Right column — the fuller detail surface (e.g. tabbed sections). */
  children: ReactNode;
}

/**
 * ProfileLayout — responsive two-column shell for entity profile pages
 * (teacher / student / staff). Renders a {@link PageHeader} (title + breadcrumbs +
 * optional actions) above a CSS grid whose left column holds a summary card and whose
 * right column holds the detail surface.
 *
 * Columns: 30 / 70 on `lg`, 35 / 65 on `sm`–`md`, and a single stacked column on `xs`
 * with the summary first (natural DOM order). Participates in the layout fill chain
 * (`flex: 1`, `minWidth: 0`) so it grows inside PageContainer's flex column without
 * forcing horizontal overflow.
 */
export function ProfileLayout({
  title,
  breadcrumbs,
  actions,
  summary,
  children,
}: ProfileLayoutProps) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <PageHeader title={title} breadcrumbs={breadcrumbs} primaryAction={actions} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '35% 65%', lg: '30% 70%' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Box sx={{ minWidth: 0 }}>{summary}</Box>
        <Box sx={{ minWidth: 0 }}>{children}</Box>
      </Box>
    </Box>
  );
}

export default ProfileLayout;
