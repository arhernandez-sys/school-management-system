import { Link as RouterLink } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  Stack,
  Typography,
} from '@mui/material';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import { EmptyState, StatusBadge } from '@shared/components';
import type { StatusKind } from '@shared/components/StatusBadge';

/**
 * PeopleListCard — a compact, reusable "list of people" widget (Principal dashboard).
 *
 * Renders an avatar (initials fallback), a name, a secondary meta line and an optional
 * StatusBadge per person, with an optional "View all" shortcut in the header. Kept
 * presentational and self-contained: it takes an already-shaped array, so it never
 * couples to the students/teachers list endpoints. Uses MUI List primitives and the
 * shared StatusBadge, matching the surrounding dashboard cards.
 *
 * Accessibility: avatars are decorative (`aria-hidden`) since they only echo the name;
 * status meaning is carried by the badge label, never color alone (WCAG 1.4.1).
 */
export interface PeopleListPerson {
  id: string;
  name: string;
  /** Secondary meta line (e.g. subject, grade, or section). */
  secondary?: string;
  avatarUrl?: string;
  status?: { label: string; kind: StatusKind };
  /** Optional in-app route making the person's name a link. */
  to?: string;
}

export interface PeopleListCardProps {
  title: string;
  people: PeopleListPerson[];
  /** Copy for the EmptyState when there are no people. */
  emptyText?: string;
  /** When set, a "View all" action in the header links here. */
  viewAllTo?: string;
  /** Label for the header action (defaults to "View all"). */
  viewAllLabel?: string;
}

/** First + last initial, e.g. "Maria Reyes" → "MR". Falls back to the first letter. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function PeopleListCard({
  title,
  people,
  emptyText = 'No one to show yet.',
  viewAllTo,
  viewAllLabel = 'View all',
}: PeopleListCardProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
        >
          <Typography variant="h4" component="h3">
            {title}
          </Typography>
          {viewAllTo && (
            <Button component={RouterLink} to={viewAllTo} size="small">
              {viewAllLabel}
            </Button>
          )}
        </Stack>

        {people.length === 0 ? (
          <EmptyState
            icon={<PeopleOutlineIcon fontSize="inherit" />}
            title="Nothing here yet"
            description={emptyText}
            variant="card"
          />
        ) : (
          <List disablePadding>
            {people.map((p, i) => (
              <Box key={p.id}>
                {i > 0 && <Divider component="li" />}
                <ListItem
                  sx={{ px: 0, py: 1.25, gap: 1 }}
                  secondaryAction={
                    p.status ? <StatusBadge label={p.status.label} kind={p.status.kind} /> : undefined
                  }
                >
                  <ListItemAvatar>
                    <Avatar aria-hidden src={p.avatarUrl} sx={{ width: 40, height: 40 }}>
                      {initials(p.name)}
                    </Avatar>
                  </ListItemAvatar>
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" component="p" noWrap>
                      {p.to ? (
                        <Link component={RouterLink} to={p.to} underline="hover" color="inherit">
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                    </Typography>
                    {p.secondary && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {p.secondary}
                      </Typography>
                    )}
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

export default PeopleListCard;
