import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { ReactNode } from 'react';

/**
 * PrintLayout — print-optimized wrapper for report cards & transcripts
 * (design-system §5 #21; D27 browser print/PDF is the v1 export path).
 *
 * On screen it renders a bordered "document" with a school-identity header and a
 * Print button. In print (`@media print`) the app chrome and the Print button are
 * hidden, the document fills the page, borders/shadows are removed, and content is
 * allowed to break across pages sensibly.
 *
 * The `@media print` rules are injected once via a scoped <style> so no global CSS
 * file is required. Callers wrap their rendered report in this component.
 */
export interface PrintLayoutProps {
  /** School / document title (e.g. school name). */
  schoolName: string;
  /** Document subtitle (e.g. "Report Card — Semester 1, 2025-2026"). */
  documentTitle: string;
  /** Optional logo URL; falls back to no image. */
  logoUrl?: string | null;
  /**
   * Optional letterhead contact line — address · phone · email (D39, Meeting #2 "*Letterhead").
   *
   * The school identity already reached this component as a NAME only, so a printed
   * report card carried no address and no way to contact the issuing institution. A
   * receiving school or employer holding the paper needs both. Falsy entries are dropped
   * rather than printed as gaps, so a profile with only a phone number still reads well.
   */
  contactLines?: Array<string | null | undefined>;
  /** Optional right-aligned meta (issue date, student number). */
  meta?: ReactNode;
  children: ReactNode;
  /** Label for the print button. */
  printLabel?: string;
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #sis-print-root, #sis-print-root * { visibility: visible !important; }
  #sis-print-root {
    position: absolute !important;
    left: 0; top: 0; width: 100%;
    margin: 0 !important; padding: 0 !important;
    border: 0 !important; box-shadow: none !important;
  }
  .sis-print-hide { display: none !important; }
  #sis-print-root .MuiPaper-root { box-shadow: none !important; }
}
`;

export function PrintLayout({
  schoolName,
  documentTitle,
  logoUrl,
  contactLines,
  meta,
  children,
  printLabel = 'Print / Save as PDF',
}: PrintLayoutProps) {
  const contact = (contactLines ?? []).map((l) => (l ?? '').trim()).filter(Boolean);
  return (
    <>
      <style>{PRINT_CSS}</style>

      <Stack direction="row" justifyContent="flex-end" className="sis-print-hide" sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          {printLabel}
        </Button>
      </Stack>

      <Box
        id="sis-print-root"
        sx={{
          maxWidth: 840,
          mx: 'auto',
          p: { xs: 3, sm: 4 },
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            {logoUrl && (
              <Box
                component="img"
                src={logoUrl}
                alt=""
                sx={{ height: 56, width: 56, objectFit: 'contain' }}
              />
            )}
            <Box>
              <Typography variant="h3" component="h1">
                {schoolName}
              </Typography>
              <Typography variant="subtitle1" color="text.secondary">
                {documentTitle}
              </Typography>
              {contact.length > 0 && (
                <Typography variant="caption" color="text.secondary" component="div">
                  {contact.join(' · ')}
                </Typography>
              )}
            </Box>
          </Stack>
          {meta && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="body2" color="text.secondary" component="div">
                {meta}
              </Typography>
            </Box>
          )}
        </Stack>

        <Divider sx={{ my: 2 }} />

        {children}
      </Box>
    </>
  );
}

export default PrintLayout;
