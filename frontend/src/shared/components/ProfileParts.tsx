import { Avatar, Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';
import type { StatCardColor } from './StatCard';
import { avatarAccent, avatarInitials } from './profileIdentity';

/**
 * ProfileParts — the shared building blocks for entity profile "hero" summary cards
 * (teacher · student · …). Extracted so every profile reads as one system: the same ringed,
 * palette-tinted avatar, the same iconed section headings, and the same accent stat tiles.
 * Pure helpers (initials, accent, PROFILE_ACCENTS) live in `./profileIdentity`.
 *
 * Accessibility: the avatar and all heading/tile icons are decorative (`aria-hidden`) — their
 * meaning is always carried by adjacent text (a name, a heading, a value), never color alone
 * (WCAG 1.4.1).
 */

export interface ProfileAvatarProps {
  /** Name used for the initials fallback and the deterministic tint. */
  name: string;
  /** Optional photo; when absent, initials on a name-derived palette tint are shown. */
  src?: string;
  /** Diameter in px (default 88). */
  size?: number;
}

/**
 * ProfileAvatar — the ringed, palette-tinted identity avatar shared by profile hero cards.
 * The paper-colored ring + soft shadow lift it off the banner it overlaps.
 */
export function ProfileAvatar({ name, src, size = 88 }: ProfileAvatarProps) {
  const accent = avatarAccent(name);
  return (
    <Avatar
      aria-hidden
      src={src}
      sx={(theme) => ({
        width: size,
        height: size,
        fontSize: `${(size / 50).toFixed(2)}rem`,
        border: `3px solid ${theme.palette.background.paper}`,
        boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        color: theme.palette[accent].contrastText,
        bgcolor: theme.palette[accent].main,
      })}
    >
      {avatarInitials(name)}
    </Avatar>
  );
}

export interface ProfileSectionHeadingProps {
  /** Optional leading accent icon (decorative). */
  icon?: ReactNode;
  children: ReactNode;
}

/** Small overline heading that opens each summary section, with a leading accent icon. */
export function ProfileSectionHeading({ icon, children }: ProfileSectionHeadingProps) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }} component="h3">
      {icon && (
        <Box aria-hidden sx={{ display: 'flex', color: 'text.secondary' }}>
          {icon}
        </Box>
      )}
      <Typography
        variant="overline"
        color="text.secondary"
        component="span"
        sx={{ lineHeight: 1.5 }}
      >
        {children}
      </Typography>
    </Stack>
  );
}

export interface ProfileStatTileProps {
  /** Leading icon (decorative). */
  icon: ReactNode;
  /** The figure (number) or short fact (string) — text always carries the meaning. */
  value: ReactNode;
  label: string;
  color: StatCardColor;
}

/**
 * ProfileStatTile — a statistic rendered as a tinted tile: an accent icon-chip over a value
 * and a caption label. Mirrors {@link StatCard}'s `alpha(color, .12)` icon-chip idiom so
 * profile stats read as part of the same system.
 */
export function ProfileStatTile({ icon, value, label, color }: ProfileStatTileProps) {
  return (
    <Stack
      spacing={0.5}
      sx={(theme) => ({
        alignItems: 'center',
        textAlign: 'center',
        px: 1,
        py: 1.5,
        borderRadius: 2,
        bgcolor: alpha(theme.palette[color].main, 0.08),
      })}
    >
      <Box
        aria-hidden
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 2,
          color: theme.palette[color].main,
          bgcolor: alpha(theme.palette[color].main, 0.14),
        })}
      >
        {icon}
      </Box>
      <Typography variant="h6" component="p" sx={{ lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
