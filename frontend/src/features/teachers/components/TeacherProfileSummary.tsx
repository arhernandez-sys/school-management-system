import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import type { ReactNode } from 'react';
import {
  LabeledProgress,
  ProfileAvatar,
  ProfileSectionHeading as SectionHeading,
  ProfileStatTile as StatTile,
  PROFILE_ACCENTS,
  StatusBadge,
} from '@shared/components';
import type { StatCardColor } from '@shared/components';
import { strings } from '@i18n/strings';
import type { TeacherDetail } from '../types';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** A single label/value row in the definition-list sections. */
function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

export interface TeacherProfileSummaryProps {
  teacher: TeacherDetail;
}

/**
 * TeacherProfileSummary — the left "identity" card of the teacher profile.
 *
 * A single soft-shadow Card led by a palette-tinted gradient banner: a ringed
 * {@link ProfileAvatar} overlaps the band, then name + designation + status chips, then
 * stacked, divider-separated sections (About Me · Personal Information · Statistics · Address ·
 * Subject Expertise). Statistics render as {@link ProfileStatTile} accents; expertise bars cycle
 * palette colors. Every section is OMITTED when its data is empty, so the card stays compact for
 * sparse (or real-backend) profiles. Statistics are derived live from `classes_taught` /
 * `student_count` — no fabricated numbers.
 *
 * Shares its avatar, section headings and stat tiles with the student profile via
 * {@link ProfileParts} so both profiles read as one system (WCAG 1.4.1: meaning never by color
 * alone — status carries a label, every stat/section carries text).
 */
export function TeacherProfileSummary({ teacher }: TeacherProfileSummaryProps) {
  /**
   * Offerings taught, and how many DISTINCT COURSES they cover.
   *
   * These two were `class_ref?.id` (distinct homerooms) and `subject?.id` (distinct
   * subjects). D31 makes the first meaningless — one offering per row, so counting distinct
   * offerings is just the row count — while the second stays a real, different number: a
   * lecturer teaching three sections of Algebra covers ONE course.
   */
  const classCount = teacher.classes_taught.length;
  const subjectCount = new Set(
    teacher.classes_taught.map((c) => c.offering.course.id),
  ).size;

  const personalRows: Array<{ label: string; value: ReactNode }> = [
    ...(teacher.gender ? [{ label: 'Gender', value: capitalize(teacher.gender) }] : []),
    // D39 (Meeting #2 item 10) — relabelled from 'Education' along with the column.
    ...(teacher.academic_qualification
      ? [{ label: 'Academic qualification', value: teacher.academic_qualification }]
      : []),
    ...(teacher.designation ? [{ label: 'Designation', value: teacher.designation }] : []),
    ...(teacher.ssno ? [{ label: 'Social security no.', value: teacher.ssno }] : []),
    ...(teacher.licensenum ? [{ label: 'Licence no.', value: teacher.licensenum }] : []),
    ...(teacher.email ? [{ label: 'Email', value: teacher.email }] : []),
    ...(teacher.phone ? [{ label: 'Phone', value: teacher.phone }] : []),
  ];

  const stats: Array<{ label: string; value: number; color: StatCardColor; icon: ReactNode }> = [
    { label: 'Offerings', value: classCount, color: 'primary', icon: <ClassOutlinedIcon fontSize="small" /> },
    { label: 'Courses', value: subjectCount, color: 'secondary', icon: <MenuBookOutlinedIcon fontSize="small" /> },
    ...(typeof teacher.student_count === 'number'
      ? [
          {
            label: 'Students',
            value: teacher.student_count,
            color: 'info' as StatCardColor,
            icon: <GroupsOutlinedIcon fontSize="small" />,
          },
        ]
      : []),
  ];

  const expertise = teacher.expertise ?? [];

  return (
    <Card sx={{ overflow: 'hidden' }}>
      {/* Palette-tinted banner behind the identity header (decorative). */}
      <Box
        aria-hidden
        sx={(theme) => ({
          height: 88,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.16)}, ${alpha(
            theme.palette.secondary.main,
            0.16,
          )})`,
        })}
      />
      <CardContent sx={{ mt: '-44px' }}>
        {/* Identity header — avatar overlaps the banner. */}
        <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
          <ProfileAvatar name={teacher.full_name} src={teacher.avatar_url} />
          <Box>
            <Typography variant="h6" component="h2">
              {teacher.full_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {teacher.designation ?? strings.terms.lecturer}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
            {teacher.status === 'active' ? (
              <StatusBadge label="Active" kind="success" />
            ) : (
              <StatusBadge label="Inactive" kind="neutral" />
            )}
            {teacher.has_login && <StatusBadge label="Has login" kind="info" />}
          </Stack>
        </Stack>

        {/* About Me */}
        {teacher.bio && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<PersonOutlineIcon fontSize="small" />}>About Me</SectionHeading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {teacher.bio}
            </Typography>
          </>
        )}

        {/* Personal Information */}
        {personalRows.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<BadgeOutlinedIcon fontSize="small" />}>
              Personal Information
            </SectionHeading>
            <Box
              component="dl"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                rowGap: 1,
                columnGap: 2,
                m: 0,
                mt: 1,
              }}
            >
              {personalRows.map((r) => (
                <InfoRow key={r.label} label={r.label} value={r.value} />
              ))}
            </Box>
          </>
        )}

        {/* Statistics */}
        <Divider sx={{ my: 2 }} />
        <SectionHeading icon={<InsightsOutlinedIcon fontSize="small" />}>Statistics</SectionHeading>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
            gap: 1,
            mt: 1,
          }}
        >
          {stats.map((s) => (
            <StatTile key={s.label} icon={s.icon} value={s.value} label={s.label} color={s.color} />
          ))}
        </Box>

        {/* Address */}
        {teacher.address && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<PlaceOutlinedIcon fontSize="small" />}>Address</SectionHeading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {teacher.address}
            </Typography>
          </>
        )}

        {/* Subject Expertise */}
        {expertise.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<SchoolOutlinedIcon fontSize="small" />}>
              Subject Expertise
            </SectionHeading>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {expertise.map((e, i) => (
                <LabeledProgress
                  key={e.area}
                  label={e.area}
                  value={e.level}
                  color={PROFILE_ACCENTS[i % PROFILE_ACCENTS.length]}
                />
              ))}
            </Stack>
          </>
        )}

        {/* Account — audit dates (created / last updated). */}
        <Divider sx={{ my: 2 }} />
        <SectionHeading icon={<HistoryOutlinedIcon fontSize="small" />}>Account</SectionHeading>
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            rowGap: 1,
            columnGap: 2,
            m: 0,
            mt: 1,
          }}
        >
          <InfoRow label="Created" value={formatDate(teacher.audit.created_at)} />
          <InfoRow label="Last updated" value={formatDate(teacher.audit.updated_at)} />
        </Box>
      </CardContent>
    </Card>
  );
}

export default TeacherProfileSummary;
