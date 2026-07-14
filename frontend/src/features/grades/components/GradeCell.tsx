import { useState } from 'react';
import { Box, IconButton, InputAdornment, Menu, MenuItem, TextField, Tooltip } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { StatusBadge } from '@shared/components';
import type { GradeStatus } from '@shared/types/enums';
import { statusPresentation } from './gradeDisplay';

/**
 * A single editable gradebook cell (one student × one assessment).
 *
 * Editable states: a numeric score input (validated 0..max_score inline) when the cell
 * is `graded`, or a status badge (absent/excused/exempt/pending) otherwise. The cell
 * menu switches status (FR-GRD-05); non-graded statuses clear the score and are excluded
 * from the weighted term base. Read-only mode (P/S view, or a non-member historical row)
 * renders the value without inputs.
 */
export interface GradeCellValue {
  status: GradeStatus;
  score: number | null;
}

export interface GradeCellProps {
  value: GradeCellValue;
  maxScore: number;
  studentName: string;
  assessmentTitle: string;
  editable: boolean;
  dirty: boolean;
  onChange: (next: GradeCellValue) => void;
}

const STATUS_OPTIONS: { status: GradeStatus; label: string }[] = [
  { status: 'graded', label: 'Enter a score' },
  { status: 'absent', label: 'Absent' },
  { status: 'excused', label: 'Excused' },
  { status: 'exempt', label: 'Exempt' },
  { status: 'pending', label: 'Pending (not yet graded)' },
];

export function GradeCell({
  value,
  maxScore,
  studentName,
  assessmentTitle,
  editable,
  dirty,
  onChange,
}: GradeCellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const scoreError =
    value.status === 'graded' && value.score != null && (value.score < 0 || value.score > maxScore);

  const handleScore = (raw: string) => {
    if (raw === '') {
      onChange({ status: 'graded', score: null });
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange({ status: 'graded', score: num });
  };

  const chooseStatus = (status: GradeStatus) => {
    setAnchor(null);
    if (status === 'graded') {
      onChange({ status: 'graded', score: value.status === 'graded' ? value.score : null });
    } else {
      onChange({ status, score: null });
    }
  };

  // Read-only rendering (P/S view-all, or a historical non-member row).
  if (!editable) {
    if (value.status === 'graded') {
      return (
        <Box sx={{ minWidth: 56, textAlign: 'center' }}>
          {value.score != null ? `${value.score}` : '—'}
        </Box>
      );
    }
    const { label, kind } = statusPresentation(value.status);
    return <StatusBadge label={label} kind={kind} />;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        // A dirty cell gets a subtle left accent so unsaved edits are visible.
        borderLeft: dirty ? '3px solid' : '3px solid transparent',
        borderLeftColor: dirty ? 'warning.main' : 'transparent',
        pl: 0.5,
      }}
    >
      {value.status === 'graded' ? (
        <TextField
          value={value.score ?? ''}
          onChange={(e) => handleScore(e.target.value)}
          size="small"
          type="number"
          error={scoreError}
          inputProps={{
            min: 0,
            max: maxScore,
            'aria-label': `${assessmentTitle} score for ${studentName}, out of ${maxScore}`,
            style: { textAlign: 'right', width: 44, padding: '6px 4px' },
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end" sx={{ ml: 0 }}>
                <Box component="span" sx={{ fontSize: 11, color: 'text.disabled' }}>
                  /{maxScore}
                </Box>
              </InputAdornment>
            ),
          }}
          helperText={scoreError ? `0–${maxScore}` : undefined}
          FormHelperTextProps={{ sx: { m: 0, fontSize: 10, whiteSpace: 'nowrap' } }}
        />
      ) : (
        <StatusBadge {...statusPresentation(value.status)} />
      )}

      <Tooltip title="Change status">
        <IconButton
          size="small"
          aria-label={`Change ${assessmentTitle} status for ${studentName}`}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {STATUS_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.status}
            selected={opt.status === value.status}
            onClick={() => chooseStatus(opt.status)}
          >
            {opt.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

export default GradeCell;
