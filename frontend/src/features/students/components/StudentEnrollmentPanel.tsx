import { Link as RouterLink } from 'react-router-dom';
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
  /** Links each class to its detail page. Off for a student viewing their own profile — they
   *  have no access to a class's roster page. */
  linkClasses?: boolean;
}

/**
 * StudentEnrollmentPanel — the student's enrollment as a compact card.
 *
 * **D29 rewrite.** This card used to show ONE section (a linked title plus grade · section ·
 * enrolled-since tiles), because a student had exactly one homeroom. A sixth-former enrols in
 * each subject class separately, so the card now lists ALL their classes as chips and reports
 * how many.
 *
 * Year group is shown **separately from the class list**, and is read from
 * `student.year_group` — the student's own level — rather than from a class's `grade_level`.
 * Those are different facts: a Lower 6 student can legitimately sit in a class labelled for
 * Upper 6, and deriving one from the other would silently misreport it.
 *
 * Shared by the P/S/teacher student detail page and the student's own "My Profile".
 */
export function StudentEnrollmentPanel({
  student,
  yearName,
  linkClasses = true,
}: StudentEnrollmentPanelProps) {
  const classes = student.current_classes ?? [];

  if (classes.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="Not enrolled"
        description={
          yearName
            ? `This student was not enrolled in any classes in ${yearName}.`
            : 'This student is not enrolled in any subject classes yet.'
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
          Subject classes
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
          {classes.map((c) =>
            linkClasses ? (
              <Chip
                key={c.id}
                component={RouterLink}
                to={`${ROUTES.classes}/${c.id}`}
                label={c.name}
                size="small"
                clickable
                variant="outlined"
              />
            ) : (
              <Chip key={c.id} label={c.name} size="small" variant="outlined" />
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
          value={student.year_group || '—'}
          label="Year group"
          color="secondary"
        />
        <ProfileStatTile
          icon={<ClassOutlinedIcon fontSize="small" />}
          value={String(classes.length)}
          label={classes.length === 1 ? 'Class' : 'Classes'}
          color="info"
        />
        <ProfileStatTile
          icon={<CalendarMonthOutlinedIcon fontSize="small" />}
          value={student.enrollment_date || '—'}
          label="Enrolled since"
          color="primary"
        />
      </Box>

      {linkClasses && (
        <Box sx={{ mt: 2 }}>
          <MuiLink
            component={RouterLink}
            to={`${ROUTES.classes}`}
            underline="hover"
            variant="body2"
          >
            Manage class enrollment
          </MuiLink>
        </Box>
      )}
    </Paper>
  );
}

export default StudentEnrollmentPanel;
