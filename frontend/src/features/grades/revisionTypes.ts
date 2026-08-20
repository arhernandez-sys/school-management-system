/**
 * Grade revision / second opportunity wire types (D30 §D7, brief §20).
 *
 * Hand-written, like the rest of the D30/D31 surface: `orval.config.ts` generates only the
 * auth / health / settings / courses tags, so every other module owns its wire types here.
 *
 * **The original score is never overwritten.** `original_score` is what the student had
 * when the request was filed and `proposed_score` is what the Lecturer asked for; on
 * approval the second is written to `assessment_grades.makeup_score` and the first stays on
 * the grade row untouched. Both are on this shape so a queue row can read "60 → 91 of 100"
 * without a second call.
 */

import type { OfferingRef } from '@shared/types/api';

export type GradeRevisionStatus = 'pending' | 'approved' | 'denied';

export interface GradeRevisionStudentRef {
  id: string;
  full_name: string;
  student_number: string;
}

/**
 * One request, carrying everything §D8 says a notification must identify — student,
 * course, assessment, lecturer, request date, reason and status. Deliberately fat: the
 * Dean's queue has to be workable without a fetch per row.
 */
export interface GradeRevision {
  id: string;
  assessment_grade_id: string;
  status: GradeRevisionStatus;
  reason: string;
  original_score: number | null;
  proposed_score: number;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;

  student: GradeRevisionStudentRef | null;
  assessment_id: string | null;
  assessment_title: string;
  max_score: number | null;
  /**
   * The offering the disputed grade belongs to.
   *
   * **D31** — replaces four flat fields: `class_subject_id`, `subject_name`,
   * `subject_code` and `section_name`. Three of those existed only to render the queue
   * row's label, and the label is derived server-side now. Nullable for a revision whose
   * offering was since deleted; a queue row must still be readable after that.
   */
  offering: OfferingRef | null;
  requested_by_user_id: string;
  requested_by_name: string;
  decided_by_user_id: string | null;
  decided_by_name: string | null;
  /** True when the caller may still withdraw this — their own request, still pending. */
  can_withdraw: boolean;
}

export interface GradeRevisionList {
  items: GradeRevision[];
  /**
   * Awaiting the CALLER's decision. Non-zero only for the Dean, which is what makes it
   * safe to drive a badge from: the number means "this needs you".
   */
  pending_for_me: number;
}

export interface GradeRevisionCreatePayload {
  student_id: string;
  /** Required — brief §20 asks for a description, and the Dean needs something to rule on. */
  reason: string;
  proposed_score: number;
}

export interface GradeRevisionDecisionPayload {
  status: 'approved' | 'denied';
  decision_note?: string | null;
}

/** The bell payload. `unread_count` is the SUM of the two components (§D8). */
export interface UnreadCount {
  unread_count: number;
  unread_announcements: number;
  pending_grade_revisions: number;
}

export const REVISION_STATUS_LABEL: Record<GradeRevisionStatus, string> = {
  pending: 'Awaiting the Dean',
  approved: 'Approved',
  denied: 'Denied',
};
