import { Box, Checkbox, FormControlLabel, InputAdornment, TextField } from '@mui/material';
import { StatusBadge } from '@shared/components';
import type { GradeStatus } from '@shared/types/enums';
import { statusPresentation } from './gradeDisplay';

/**
 * One student's mark for one assessment (D47).
 *
 * The box is simply OPEN while marking is: type a number and it is a mark, clear it and the
 * student is blank again. The only other choice is the inline **Excused** tick, which a
 * blank student needs so the closing window does not turn them into a 0. There is no
 * status menu any more — absent and exempt are no longer chosen here (an older row that
 * carries one still renders it read-only).
 *
 * Read-only mode (Dean, Registrar, a closed window, a former student) renders the value,
 * and a blank on a closed window as "0 (auto)" — because that is what the term grade
 * counts it as.
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
  /** Blank on a closed window — counts as 0 (server-computed `auto_zero`). */
  autoZero?: boolean;
  onChange: (next: GradeCellValue) => void;
}

export function GradeCell({
  value,
  maxScore,
  studentName,
  assessmentTitle,
  editable,
  dirty,
  autoZero = false,
  onChange,
}: GradeCellProps) {
  const excused = value.status === 'excused';
  const scoreError =
    value.status === 'graded' && value.score != null && (value.score < 0 || value.score > maxScore);

  const handleScore = (raw: string) => {
    if (raw.trim() === '') {
      // Clearing the box makes the student blank again — not a 0.
      onChange({ status: 'pending', score: null });
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange({ status: 'graded', score: num });
  };

  if (!editable) {
    if (value.status === 'graded' && value.score != null) {
      return <Box sx={{ minWidth: 56, textAlign: 'right' }}>{value.score}</Box>;
    }
    if (autoZero) {
      return (
        <Box
          sx={{ minWidth: 56, textAlign: 'right', color: 'text.secondary' }}
          title="No mark was entered before marking closed, so this counts as 0."
        >
          0 <Box component="span" sx={{ fontSize: 11 }}>(auto)</Box>
        </Box>
      );
    }
    if (value.status === 'pending') {
      return <Box sx={{ minWidth: 56, textAlign: 'right', color: 'text.disabled' }}>—</Box>;
    }
    return <StatusBadge {...statusPresentation(value.status)} />;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 1,
        flexWrap: 'wrap',
        // A dirty cell gets a subtle left accent so unsaved edits are visible.
        borderLeft: '3px solid',
        borderLeftColor: dirty ? 'warning.main' : 'transparent',
        pl: 0.5,
      }}
    >
      <TextField
        value={value.status === 'graded' ? (value.score ?? '') : ''}
        onChange={(e) => handleScore(e.target.value)}
        size="small"
        type="number"
        disabled={excused}
        placeholder={excused ? '' : '—'}
        error={scoreError}
        inputProps={{
          min: 0,
          max: maxScore,
          step: 0.5,
          inputMode: 'decimal',
          'aria-label': `${assessmentTitle} mark for ${studentName}, out of ${maxScore}`,
          style: { textAlign: 'right', width: 56, padding: '6px 4px' },
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
      <FormControlLabel
        sx={{ mr: 0 }}
        control={
          <Checkbox
            size="small"
            checked={excused}
            onChange={(e) =>
              onChange(e.target.checked ? { status: 'excused', score: null } : { status: 'pending', score: null })
            }
            inputProps={{ 'aria-label': `Excuse ${studentName} from ${assessmentTitle}` }}
          />
        }
        label={<Box component="span" sx={{ fontSize: 13 }}>Excused</Box>}
      />
    </Box>
  );
}

export default GradeCell;
