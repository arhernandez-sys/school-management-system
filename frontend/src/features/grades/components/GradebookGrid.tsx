import { useMemo } from 'react';
import {
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PublicIcon from '@mui/icons-material/Public';
import { StatusBadge } from '@shared/components';
import { letterFor } from '@shared/api/mocks/demo/dataset';
import type { Gradebook, GradebookRow } from '../types';
import { GradeCell, type GradeCellValue } from './GradeCell';
import { formatNumeric, letterKind } from './gradeDisplay';

/**
 * The gradebook grid (design-system §7.7): students (section roster ∪ historical grade
 * rows) × the subject's assessments, with a computed Term column.
 *
 * Layout: a horizontally-scrollable table with a STICKY first column (Student) and a
 * STICKY header row — so a roster of ~35 × 12 assessments scans on a tablet without
 * losing the axis labels. Draft state is owned by the parent; the Term column recomputes
 * live from the draft (weighted, graded-only) so the teacher sees the effect of an edit
 * before saving. Non-member (transferred/withdrawn) rows are flagged and read-only.
 */
export interface GradebookGridProps {
  gradebook: Gradebook;
  /** Draft overrides keyed `${assessmentId}:${studentId}`. */
  draft: Map<string, GradeCellValue>;
  /** Whether the current viewer may edit (teacher owns it). */
  canEdit: boolean;
  onCellChange: (assessmentId: string, studentId: string, next: GradeCellValue) => void;
}

const cellKey = (assessmentId: string, studentId: string) => `${assessmentId}:${studentId}`;

/** Resolve the effective value for a cell: draft override wins over the server row. */
function effectiveValue(
  row: GradebookRow,
  assessmentId: string,
  draft: Map<string, GradeCellValue>,
): GradeCellValue {
  const override = draft.get(cellKey(assessmentId, row.student.id));
  if (override) return override;
  const cell = row.cells.find((c) => c.assessment_id === assessmentId);
  return { status: cell?.status ?? 'pending', score: cell?.score ?? null };
}

/** Live weighted term grade from the current (possibly-draft) values (graded-only). */
function liveTermGrade(
  row: GradebookRow,
  gradebook: Gradebook,
  draft: Map<string, GradeCellValue>,
): { numeric: number | null; letter: string | null } {
  let weightedSum = 0;
  let weightBase = 0;
  for (const a of gradebook.assessments) {
    if (a.status !== 'graded') continue; // only fully-graded assessments count toward the term
    const v = effectiveValue(row, a.id, draft);
    if (v.status !== 'graded' || v.score == null) continue;
    const pct = (v.score / a.max_score) * 100;
    weightedSum += pct * a.weight;
    weightBase += a.weight;
  }
  if (weightBase === 0) return { numeric: null, letter: null };
  const numeric = Math.round((weightedSum / weightBase) * 100) / 100;
  return { numeric, letter: letterFor(numeric) };
}

const STICKY_BG = 'background.paper';

export function GradebookGrid({ gradebook, draft, canEdit, onCellChange }: GradebookGridProps) {
  const { assessments, rows } = gradebook;

  // Sort: active members first (by name), then historical rows.
  const orderedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.is_active_member !== b.is_active_member) return a.is_active_member ? -1 : 1;
        return a.student.full_name.localeCompare(b.student.full_name);
      }),
    [rows],
  );

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto', maxWidth: '100%' }}
    >
      <Table size="small" stickyHeader aria-label={`Gradebook for ${gradebook.class_subject?.display_name ?? 'class'}`}>
        <TableHead>
          <TableRow>
            <TableCell
              component="th"
              scope="col"
              sx={{
                position: 'sticky',
                left: 0,
                zIndex: 3,
                bgcolor: STICKY_BG,
                minWidth: 180,
              }}
            >
              Student
            </TableCell>
            {assessments.map((a) => (
              <TableCell key={a.id} align="center" scope="col" sx={{ minWidth: 120, bgcolor: STICKY_BG }}>
                <Stack spacing={0.25} alignItems="center">
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {a.title}
                    </Typography>
                    <Tooltip
                      title={
                        a.is_released
                          ? 'Released — students can see these grades'
                          : 'Unreleased — visible to you only'
                      }
                    >
                      {a.is_released ? (
                        <PublicIcon fontSize="inherit" color="success" aria-label="Released" />
                      ) : (
                        <LockOutlinedIcon fontSize="inherit" color="disabled" aria-label="Unreleased" />
                      )}
                    </Tooltip>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    /{a.max_score} · w{a.weight}
                  </Typography>
                  {a.status !== 'graded' && (
                    <Typography variant="caption" color="text.disabled">
                      {a.status === 'draft' ? 'draft' : 'not in term'}
                    </Typography>
                  )}
                </Stack>
              </TableCell>
            ))}
            <TableCell
              align="center"
              scope="col"
              sx={{ minWidth: 120, bgcolor: STICKY_BG }}
            >
              Term grade
              <Typography variant="caption" color="text.secondary" component="div">
                weighted
              </Typography>
            </TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {orderedRows.map((row) => {
            const term = liveTermGrade(row, gradebook, draft);
            const rowEditable = canEdit && row.is_active_member;
            return (
              <TableRow key={row.student.id} hover>
                <TableCell
                  component="th"
                  scope="row"
                  sx={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    bgcolor: STICKY_BG,
                    borderRight: '1px solid',
                    borderRightColor: 'divider',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                    {row.student.full_name}
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                    <Typography variant="caption" color="text.secondary">
                      {row.student.student_number}
                    </Typography>
                    {!row.is_active_member && (
                      <StatusBadge label="Transferred" kind="warning" />
                    )}
                  </Stack>
                </TableCell>

                {assessments.map((a) => {
                  const v = effectiveValue(row, a.id, draft);
                  const isDirty = draft.has(cellKey(a.id, row.student.id));
                  const cellEditable = rowEditable && a.is_editable;
                  return (
                    <TableCell key={a.id} align="center">
                      <GradeCell
                        value={v}
                        maxScore={a.max_score}
                        studentName={row.student.full_name}
                        assessmentTitle={a.title}
                        editable={cellEditable}
                        dirty={isDirty}
                        onChange={(next) => onCellChange(a.id, row.student.id, next)}
                      />
                    </TableCell>
                  );
                })}

                <TableCell align="center">
                  <Stack spacing={0.25} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatNumeric(term.numeric)}
                    </Typography>
                    {term.letter && <StatusBadge label={term.letter} kind={letterKind(term.letter)} />}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default GradebookGrid;
