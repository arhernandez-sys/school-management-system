import type { StatusKind } from '@shared/components';
import type { AssessmentStatus, AssessmentType } from '@shared/types/enums';

/** Human label + badge color for each assessment status (single source of truth). */
export const STATUS_META: Record<AssessmentStatus, { label: string; kind: StatusKind }> = {
  draft: { label: 'Draft', kind: 'neutral' },
  published: { label: 'Published', kind: 'info' },
  grading: { label: 'Grading', kind: 'warning' },
  graded: { label: 'Graded', kind: 'success' },
};

/**
 * Legal forward transitions (+ single-step rollback) — mirrors the server's
 * legal-transition set (api-spec §5.6 / API-16). The status action menu offers only
 * these so a teacher never attempts an `invalid_transition`.
 */
export const NEXT_STATUSES: Record<AssessmentStatus, AssessmentStatus[]> = {
  draft: ['published'],
  published: ['grading', 'draft'],
  grading: ['graded', 'published'],
  graded: [],
};

/** Verb-forward label for a transition action (e.g. "Publish", "Revert to draft"). */
export function transitionLabel(to: AssessmentStatus, from: AssessmentStatus): string {
  if (to === 'draft') return 'Revert to draft';
  if (to === 'published') return from === 'grading' ? 'Back to published' : 'Publish';
  if (to === 'grading') return 'Start grading';
  return 'Mark graded';
}

export const TYPE_LABEL: Record<AssessmentType, string> = {
  quiz: 'Quiz',
  class_work: 'Class Work',
  project: 'Project',
  test: 'Test',
  research: 'Research',
  journal: 'Journal',
  assignment: 'Assignment',
  simulation: 'Simulation',
  case_study: 'Case Study',
  group_work: 'Group Work',
  final_project: 'Final Project',
  final_exam: 'Final Exam',
  timely_class_attendance: 'Timely Class Attendance',
  chapel_attendance: 'Chapel Attendance',
  // Legacy — no longer offered, still labelled for assessments saved before the change.
  exam: 'Exam',
};
