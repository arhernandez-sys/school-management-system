import { Container } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { ReactNode } from 'react';

export interface PageContainerProps {
  children: ReactNode;
  /** Extra styles merged onto the container (after the defaults). */
  sx?: SxProps<Theme>;
}

/**
 * PageContainer — the growing content column inside the layout's <main> region.
 *
 * Caps content width on large monitors (maxWidth="xl") while horizontal padding
 * stays on <main>, and grows as a flex column so list surfaces (e.g. DataTable)
 * can fill the viewport height and pin pagination toward the bottom instead of
 * leaving a tall empty band. Purely presentational.
 */
export function PageContainer({ children, sx }: PageContainerProps) {
  return (
    <Container
      maxWidth="xl"
      disableGutters
      sx={[
        {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          width: '100%',
          pt: { xs: 2, md: 3 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Container>
  );
}

export default PageContainer;
