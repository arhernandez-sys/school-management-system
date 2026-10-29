import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { StatusBadge } from '@shared/components';
import type { MyGradeSubject } from '../types';
import { letterKind, statusPresentation } from './gradeDisplay';

export interface OfferingGradesTableProps {
  /** The offering whose assessments are shown (student scope). */
  subject: MyGradeSubject;
}

/**
 * The per-offering grades table for the student "My Grades" view (§7.7, student
 * scope). Columns: Assessment / Score / Grade. A graded row shows its letter
 * StatusBadge; a non-graded row shows the status presentation (Excused / Pending).
 * D47 — a mark shows the moment the lecturer saves it, and an assessment nobody
 * marked before its window closed shows as "0 · Not submitted", because that is
 * what the course average counts it as.
 */
export function OfferingGradesTable({ subject }: OfferingGradesTableProps) {
  const subjectName = subject.offering?.offering.course.name ?? 'Course';

  if (subject.assessments.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        No grades yet.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={`${subjectName} grades`}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Assessment</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              Score
            </TableCell>
            <TableCell align="center" sx={{ fontWeight: 600 }}>
              Grade
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {subject.assessments.map((a) => (
            <TableRow key={a.assessment_id} hover>
              <TableCell>{a.title}</TableCell>
              <TableCell align="right">
                {a.status === 'graded' && a.score != null
                  ? `${a.score} / ${a.max_score}`
                  : a.auto_zero
                    ? `0 / ${a.max_score}`
                    : '—'}
              </TableCell>
              <TableCell align="center">
                {a.status === 'graded' && a.letter ? (
                  <StatusBadge label={a.letter} kind={letterKind(a.letter)} />
                ) : a.auto_zero ? (
                  <StatusBadge label="Not submitted" kind="error" />
                ) : (
                  <StatusBadge {...statusPresentation(a.status)} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default OfferingGradesTable;
