import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CakeOutlinedIcon from '@mui/icons-material/CakeOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import FamilyRestroomOutlinedIcon from '@mui/icons-material/FamilyRestroomOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import type { ReactNode } from 'react';
import {
  ProfileAvatar,
  ProfileSectionHeading as SectionHeading,
  ProfileStatTile as StatTile,
  StatusBadge,
} from '@shared/components';
import type { StatCardColor } from '@shared/components';
import { STUDENT_STATUS_KIND, STUDENT_STATUS_LABEL } from '../constants';
import type { StudentDetail } from '../types';

/** Whole years between `dob` and today; `null` for a missing/invalid/implausible date. */
function ageFrom(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
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

/** A divider-separated definition-list section with an iconed heading. */
function InfoSection({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <>
      <Divider sx={{ my: 2 }} />
      <SectionHeading icon={icon}>{title}</SectionHeading>
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
        {rows.map((r) => (
          <InfoRow key={r.label} label={r.label} value={r.value} />
        ))}
      </Box>
    </>
  );
}

export interface StudentProfileSummaryProps {
  student: StudentDetail;
}

/**
 * StudentProfileSummary — the left "identity" card of the student profile, the counterpart to
 * {@link TeacherProfileSummary} and built from the same {@link ProfileParts} so the two profiles
 * read as one system.
 *
 * A soft-shadow Card led by a palette-tinted gradient banner: a ringed {@link ProfileAvatar}
 * overlaps the band, then name + "Student #" + status/year-group chips, then divider-separated
 * sections (Statistics · Personal Information · Guardian · Address). Statistics are honest facts
 * derived from the record (age from date of birth, year group, how many subject classes) — never
 * fabricated; the whole section is omitted when none apply. Sections omit when their data is
 * empty, keeping the card compact for sparse profiles.
 */
export function StudentProfileSummary({ student }: StudentProfileSummaryProps) {
  const offeringCount = student.current_offerings?.length ?? 0;
  const age = student.date_of_birth ? ageFrom(student.date_of_birth) : null;

  // D29: the old Grade + Section tiles were read off the student's ONE homeroom. The year
  // of study is now the student's own field, and "how many courses" replaces the section
  // letter — the offerings themselves are listed by StudentEnrollmentPanel, so repeating
  // their names here would just duplicate that card.
  const stats: Array<{ label: string; value: ReactNode; color: StatCardColor; icon: ReactNode }> = [
    ...(age !== null
      ? [{ label: 'Age', value: age, color: 'primary' as StatCardColor, icon: <CakeOutlinedIcon fontSize="small" /> }]
      : []),
    ...(student.year_of_study
      ? [
          {
            label: 'Year of study',
            value: student.year_of_study,
            color: 'secondary' as StatCardColor,
            icon: <SchoolOutlinedIcon fontSize="small" />,
          },
        ]
      : []),
    ...(offeringCount > 0
      ? [
          {
            label: offeringCount === 1 ? 'Course' : 'Courses',
            value: offeringCount,
            color: 'info' as StatCardColor,
            icon: <ClassOutlinedIcon fontSize="small" />,
          },
        ]
      : []),
  ];

  const personalRows: Array<{ label: string; value: ReactNode }> = [
    { label: 'Date of birth', value: student.date_of_birth || '—' },
    { label: 'Gender', value: student.gender === 'female' ? 'Female' : 'Male' },
    ...(student.phone ? [{ label: 'Phone', value: student.phone }] : []),
  ];

  const guardianRows: Array<{ label: string; value: ReactNode }> = [
    ...(student.guardian_name ? [{ label: 'Name', value: student.guardian_name }] : []),
    ...(student.guardian_phone ? [{ label: 'Phone', value: student.guardian_phone }] : []),
    ...(student.guardian_email ? [{ label: 'Email', value: student.guardian_email }] : []),
  ];

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
          <ProfileAvatar name={student.full_name} />
          <Box>
            <Typography variant="h6" component="h2">
              {student.full_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Student # {student.student_number}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
            <StatusBadge
              label={STUDENT_STATUS_LABEL[student.status]}
              kind={STUDENT_STATUS_KIND[student.status]}
            />
            {/* D29: the header chip names the student's LEVEL, not a homeroom — they no
                longer have one class that identifies them. */}
            {student.year_of_study && <StatusBadge label={student.year_of_study} kind="info" />}
          </Stack>
        </Stack>

        {/* Statistics — honest facts only (age / year group / class count). */}
        {stats.length > 0 && (
          <>
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
          </>
        )}

        {/* Personal Information */}
        {personalRows.length > 0 && (
          <InfoSection
            icon={<BadgeOutlinedIcon fontSize="small" />}
            title="Personal Information"
            rows={personalRows}
          />
        )}

        {/* Guardian */}
        {guardianRows.length > 0 && (
          <InfoSection
            icon={<FamilyRestroomOutlinedIcon fontSize="small" />}
            title="Guardian"
            rows={guardianRows}
          />
        )}

        {/* Address */}
        {student.address && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<PlaceOutlinedIcon fontSize="small" />}>Address</SectionHeading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {student.address}
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default StudentProfileSummary;
