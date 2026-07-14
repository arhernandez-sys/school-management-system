import { useState } from 'react';
import { Button, ListItemText, Menu, MenuItem, Stack } from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { GradebookAssessment } from '../types';

/**
 * "Release grades" control (FR-GRD-09). A menu listing each assessment with a toggle to
 * release/retract its grades to students. Until released, students never receive the
 * data (server-side read filter) — an info banner elsewhere reminds the teacher.
 */
export interface ReleaseControlProps {
  assessments: GradebookAssessment[];
  disabled?: boolean;
  onToggle: (assessment: GradebookAssessment, release: boolean) => void;
}

export function ReleaseControl({ assessments, disabled = false, onToggle }: ReleaseControlProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Only assessments that have grades to release are actionable.
  const releasable = assessments.filter((a) => a.status !== 'draft');

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        endIcon={<KeyboardArrowDownIcon />}
        disabled={disabled || releasable.length === 0}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
      >
        Release grades
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {releasable.map((a) => (
          <MenuItem
            key={a.id}
            onClick={() => {
              setAnchor(null);
              onToggle(a, !a.is_released);
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              {a.is_released ? (
                <LockOutlinedIcon fontSize="small" color="disabled" />
              ) : (
                <PublicIcon fontSize="small" color="success" />
              )}
              <ListItemText
                primary={a.title}
                secondary={a.is_released ? 'Retract from students' : 'Release to students'}
              />
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default ReleaseControl;
