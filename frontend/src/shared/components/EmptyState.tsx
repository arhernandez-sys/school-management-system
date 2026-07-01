import { Box, Button, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Icon element; defaults to an inbox icon. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Optional CTA — label + handler (role-gated by the caller). */
  action?: { label: string; onClick: () => void };
  variant?: 'list' | 'card' | 'page';
}

/** Friendly, actionable empty result (design-system §5 #2, §8.2). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'list',
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 1.5,
        py: variant === 'page' ? 8 : 6,
        px: 2,
        color: 'text.secondary',
      }}
    >
      <Box sx={{ fontSize: 48, lineHeight: 0, color: 'text.disabled' }} aria-hidden>
        {icon ?? <InboxOutlinedIcon fontSize="inherit" />}
      </Box>
      <Typography variant="h4" component="p" color="text.primary">
        {title}
      </Typography>
      {description && <Typography variant="body2">{description}</Typography>}
      {action && (
        <Button variant="contained" onClick={action.onClick} sx={{ mt: 1 }}>
          {action.label}
        </Button>
      )}
    </Box>
  );
}

export default EmptyState;
