import { Box, Card, CardContent, Chip, Divider, List, ListItem, Stack, Typography } from '@mui/material';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import { EmptyState } from '@shared/components';
import { AUDIENCE_LABEL as ANNOUNCEMENT_AUDIENCE_LABEL } from '@features/announcements/presentation';
import type { DashboardAnnouncement } from '../types';

/** Format an RFC3339 instant to a short, locale-stable date. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * D30: was a second hardcoded copy of the announcements audience labels, which drifted
 * the moment the tertiary terms landed. Reuses the feature's own map instead.
 * `DashboardAnnouncement.audience` is a plain string here, hence the widening.
 */
const AUDIENCE_LABEL: Record<string, string> = ANNOUNCEMENT_AUDIENCE_LABEL;

export interface AnnouncementsListProps {
  title: string;
  announcements: DashboardAnnouncement[];
}

/**
 * Recent/targeted announcements column (dashboard §7.2). Unread items are marked with a
 * dot + bold title (never color alone — WCAG 1.4.1). Renders an EmptyState when there
 * are none so the widget never shows a blank card.
 */
export function AnnouncementsList({ title, announcements }: AnnouncementsListProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h4" component="h3" gutterBottom>
          {title}
        </Typography>
        {announcements.length === 0 ? (
          <EmptyState
            icon={<CampaignOutlinedIcon fontSize="inherit" />}
            title="No announcements"
            description="You're all caught up."
            variant="card"
          />
        ) : (
          <List disablePadding>
            {announcements.map((a, i) => (
              <Box key={a.id}>
                {i > 0 && <Divider component="li" />}
                <ListItem alignItems="flex-start" sx={{ px: 0, py: 1.5 }}>
                  <Stack spacing={0.5} sx={{ width: '100%' }}>
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
                          variant="subtitle2"
                          component="p"
                          sx={{ fontWeight: a.is_read ? 500 : 700, minWidth: 0 }}
                          noWrap
                        >
                          {a.title}
                          {!a.is_read && (
                            <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                              {' '}
                              (unread)
                            </Box>
                          )}
                        </Typography>
                      </Stack>
                      <Chip
                        label={AUDIENCE_LABEL[a.audience] ?? a.audience}
                        size="small"
                        variant="outlined"
                        sx={{ flexShrink: 0 }}
                      />
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
                      {a.body}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(a.published_at)}
                    </Typography>
                  </Stack>
                </ListItem>
              </Box>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

export default AnnouncementsList;
