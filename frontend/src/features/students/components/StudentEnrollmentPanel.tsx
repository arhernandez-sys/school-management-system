import { Link as RouterLink } from 'react-router-dom';
import { Box, Link as MuiLink, Paper, Typography } from '@mui/material';
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
}

/**
 * StudentEnrollmentPanel — the student's section for the current view, as a compact card:
 * a linked section title over tinted stat tiles (grade · section · enrolled since). Reuses
 * {@link ProfileStatTile} so it reads as part of the same system as the profile summary
 * card. Shared by the P/S/teacher student detail page and the student's own "My Profile".
 */
export function StudentEnrollmentPanel({ student, yearName }: StudentEnrollmentPanelProps) {
  const section = student.current_section;
  if (!section) {
    return (
      <EmptyState
        variant="card"
        title="Not enrolled"
        description={
          yearName
            ? `This student was not enrolled in a section in ${yearName}.`
            : 'This student is not currently enrolled in a section.'
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
          Class / homeroom
        </Typography>
        <MuiLink
          component={RouterLink}
          to={`${ROUTES.classes}/${section.id}`}
          underline="hover"
          variant="h6"
          sx={{ display: 'block', fontWeight: 600 }}
        >
          {section.name}
        </MuiLink>
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
          value={section.grade_level}
          label="Grade level"
          color="secondary"
        />
        <ProfileStatTile
          icon={<ClassOutlinedIcon fontSize="small" />}
          value={section.section}
          label="Section"
          color="info"
        />
        <ProfileStatTile
          icon={<CalendarMonthOutlinedIcon fontSize="small" />}
          value={student.enrollment_date || '—'}
          label="Enrolled since"
          color="primary"
        />
      </Box>
    </Paper>
  );
}

export default StudentEnrollmentPanel;
