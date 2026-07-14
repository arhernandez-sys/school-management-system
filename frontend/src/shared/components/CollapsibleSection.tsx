import { useId, useState } from 'react';
import { Box, Collapse, IconButton, Paper, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ReactNode } from 'react';

/**
 * CollapsibleSection — accessible expand/collapse (design-system §5 #23).
 *
 * Used by the transcript year-blocks (§7.10) and any groupable detail section. The
 * header is a real <button> that toggles the region with proper `aria-expanded` /
 * `aria-controls`, so it is keyboard-operable and announced. Motion respects the
 * global reduced-motion rule (theme MuiCssBaseline).
 */
export interface CollapsibleSectionProps {
  title: ReactNode;
  /** Optional right-aligned summary (e.g. a year average) shown in the header. */
  summary?: ReactNode;
  children: ReactNode;
  /** Start expanded (default true). */
  defaultExpanded?: boolean;
  /** Controlled expanded state (omit for uncontrolled). */
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
}

export function CollapsibleSection({
  title,
  summary,
  children,
  defaultExpanded = true,
  expanded: controlled,
  onToggle,
}: CollapsibleSectionProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
  const isControlled = controlled !== undefined;
  const open = isControlled ? controlled : uncontrolled;
  const regionId = useId();
  const headerId = useId();

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolled(next);
    onToggle?.(next);
  };

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Stack
        component="button"
        type="button"
        id={headerId}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        direction="row"
        spacing={1}
        sx={{
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          border: 0,
          bgcolor: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <Typography variant="h4" component="span">
          {title}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {summary}
          <IconButton
            component="span"
            size="small"
            aria-hidden
            tabIndex={-1}
            sx={{
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms',
            }}
          >
            <ExpandMoreIcon />
          </IconButton>
        </Stack>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box id={regionId} role="region" aria-labelledby={headerId} sx={{ p: 2, pt: 0 }}>
          {children}
        </Box>
      </Collapse>
    </Paper>
  );
}

export default CollapsibleSection;
