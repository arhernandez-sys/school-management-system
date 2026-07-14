import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { StatusBadge } from '@shared/components';
import { AUDIENCE_KIND, AUDIENCE_LABEL, formatDate } from '../presentation';
import type { AnnouncementListItem } from '../types';

/**
 * A single announcement in the feed — a clickable card (design-system feed/list §5).
 * Unread items are marked with a leading dot + bold title + a visually-hidden
 * "(unread)" label so the state is conveyed to screen readers and never by color
 * alone (WCAG 1.4.1). The whole card is a button that opens the detail + marks read.
 */
export interface AnnouncementFeedItemProps {
  announcement: AnnouncementListItem;
  onOpen: (id: string) => void;
  /** Author/principal-only controls; omit to hide. */
  onEdit?: (a: AnnouncementListItem) => void;
  onDelete?: (a: AnnouncementListItem) => void;
}

export function AnnouncementFeedItem({
  announcement: a,
  onOpen,
  onEdit,
  onDelete,
}: AnnouncementFeedItemProps) {
  const showActions = Boolean(onEdit || onDelete);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderLeft: a.is_read ? undefined : 4,
        borderLeftColor: a.is_read ? undefined : 'primary.main',
        bgcolor: a.is_read ? 'background.paper' : 'action.hover',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: 'action.selected' },
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box
          component="button"
          type="button"
          onClick={() => onOpen(a.id)}
          aria-label={`Open announcement: ${a.title}${a.is_read ? '' : ' (unread)'}`}
          sx={{
            all: 'unset',
            cursor: 'pointer',
            flexGrow: 1,
            minWidth: 0,
            display: 'block',
            borderRadius: 1,
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}
        >
          <Stack spacing={0.75}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                {!a.is_read && (
                  <Box
                    aria-hidden
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      flexShrink: 0,
                    }}
                  />
                )}
                <Typography
                  variant="subtitle1"
                  component="p"
                  sx={{ fontWeight: a.is_read ? 500 : 700, minWidth: 0 }}
                  noWrap
                >
                  {a.title}
                </Typography>
                {!a.is_read && (
                  <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                    (unread)
                  </Box>
                )}
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: 'center' }}>
                <StatusBadge
                  label={
                    a.audience === 'class' && a.class_ref
                      ? a.class_ref.name
                      : AUDIENCE_LABEL[a.audience]
                  }
                  kind={AUDIENCE_KIND[a.audience]}
                />
              </Stack>
            </Stack>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {a.body_preview}
            </Typography>

            <Typography variant="caption" color="text.secondary">
              {a.author.full_name} · {formatDate(a.published_at)}
              {a.expires_at ? ` · expires ${formatDate(a.expires_at)}` : ''}
            </Typography>
          </Stack>
        </Box>

        {showActions && (
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
            {onEdit && (
              <Tooltip title="Edit">
                <IconButton
                  size="small"
                  aria-label={`Edit ${a.title}`}
                  onClick={() => onEdit(a)}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip title="Delete">
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`Delete ${a.title}`}
                  onClick={() => onDelete(a)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

export default AnnouncementFeedItem;
