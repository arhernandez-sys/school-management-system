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
  /** The offering whose released assessments are shown (student scope). */
  subject: MyGradeSubject;
}

/**
 * The per-offering released-grades table for the student "My Grades" view
 * (§7.7, student scope). Columns: Assessment / Type / Score / Grade. A graded row
 * shows its letter StatusBadge; a non-graded row shows the status presentation
 * (Absent / Excused / Exempt / Pending). Renders a friendly empty line when the
 * offering has no released grades yet. Read-only; the server already applies the
 * release filter, so unreleased assessments are never in the payload.
 */
export function OfferingGradesTable({ subject }: OfferingGradesTableProps) {
  const subjectName = subject.offering?.offering.course.name ?? 'Course';

  if (subject.assessments.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        No released grades yet.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={`${subjectName} grades`}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Assessment</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
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
              <TableCell sx={{ textTransform: 'capitalize' }}>{a.type}</TableCell>
              <TableCell align="right">
                {a.status === 'graded' && a.score != null ? `${a.score} / ${a.max_score}` : '—'}
              </TableCell>
              <TableCell align="center">
                {a.status === 'graded' && a.letter ? (
                  <StatusBadge label={a.letter} kind={letterKind(a.letter)} />
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
