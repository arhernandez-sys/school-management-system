import { Link as RouterLink } from 'react-router-dom';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import { Box, Chip, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { EmptyState, ProfileSectionHeading, ProfileStatTile } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';
import type { StudentDetail } from '../types';

export interface StudentEnrollmentPanelProps {
  student: StudentDetail;
  /** When set, personalizes the "not enrolled" copy to the selected year. */
  yearName?: string;
  /** Links each offering to its detail page. Off for a student viewing their own profile —
   *  they have no access to an offering's roster page. */
  linkOfferings?: boolean;
}

/**
 * StudentEnrollmentPanel — the student's enrollment as a compact card.
 *
 * **D29 rewrite, D31 retitled.** This card used to show ONE section (a linked title plus
 * grade · section · enrolled-since tiles), because a student had exactly one homeroom. A
 * college student enrols in each course separately, so the card lists ALL their offerings as
 * chips and reports how many.
 *
 * Each chip prints the offering's server-computed `label` (course code + section), which is
 * what makes two sections of one course distinguishable — under D29 it printed a homeroom
 * `name`, and an offering has none.
 *
 * Year of study is shown **separately from the offering list**, and is read from
 * `student.year_of_study` — the student's own level — never derived from what they take.
 * Those are different facts: a First-year can legitimately sit a course most Second-years
 * take, and deriving one from the other would silently misreport it.
 *
 * Shared by the P/S/lecturer student detail page and the student's own "My Profile".
 */
export function StudentEnrollmentPanel({
  student,
  yearName,
  linkOfferings = true,
}: StudentEnrollmentPanelProps) {
  const offerings = student.current_offerings ?? [];

  if (offerings.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="Not enrolled"
        description={
          yearName
            ? `This student was not enrolled in any courses in ${yearName}.`
            : 'This student is not enrolled in any courses yet.'
        }
      />
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <ProfileSectionHeading icon={<SchoolOutlinedIcon fontSize="small" />}>
        Enrollment
      </ProfileSectionHeading>

      <Box sx={{ mt: 1.5, mb: 2.5 }}>
        <Typography variant="overline" color="text.secondary">
          Course offerings
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
          {offerings.map((o) =>
            linkOfferings ? (
              <Chip
                key={o.id}
                component={RouterLink}
                to={`${ROUTES.offerings}/${o.id}`}
                label={o.label}
                size="small"
                clickable
                variant="outlined"
              />
            ) : (
              <Chip key={o.id} label={o.label} size="small" variant="outlined" />
            ),
          )}
        </Stack>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
          gap: 1.5,
        }}
      >
        <ProfileStatTile
          icon={<SchoolOutlinedIcon fontSize="small" />}
          value={student.year_of_study || '—'}
          label="Year of study"
          color="secondary"
        />
        <ProfileStatTile
          icon={<ClassOutlinedIcon fontSize="small" />}
          value={String(offerings.length)}
          label={offerings.length === 1 ? 'Course' : 'Courses'}
          color="info"
        />
        <ProfileStatTile
          icon={<CalendarMonthOutlinedIcon fontSize="small" />}
          value={formatSchoolDate(student.enrollment_date) || '—'}
          label="Enrolled since"
          color="primary"
        />
      </Box>

      {linkOfferings && (
        <Box sx={{ mt: 2 }}>
          <MuiLink
            component={RouterLink}
            to={`${ROUTES.offerings}`}
            underline="hover"
            variant="body2"
          >
            Manage course enrollment
          </MuiLink>
        </Box>
      )}
    </Paper>
  );
}

export default StudentEnrollmentPanel;
