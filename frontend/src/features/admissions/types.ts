/**
 * Admissions wire types (D30 §D11) — Sections A–G of the BAJC application form.
 *
 * Hand-written, like Students and Programmes: the admissions endpoints are not in the
 * served OpenAPI and `npm run generate:api` is forbidden (`openapi.json` covers 4 of 14
 * modules, so regenerating deletes more than it adds).
 *
 * **Almost everything is optional**, and that is what a `draft` means rather than
 * looseness: the Registrar transcribes a paper form section by section, so the shape
 * cannot demand a complete record. Completeness is asserted by the server at the SUBMIT
 * and ACCEPT transitions, and reported back as `blocking_issues` so the UI can explain
 * itself before the user presses anything.
 */

/**
 * D44 — the client's ten-state vocabulary, from the `sims_10` dump. Four states are new
 * and `denied` was RENAMED to `rejected`; there is no alias for the old spelling, in the
 * enum or on the route.
 *
 * Ordered as the DB enum is, which is roughly the order an application moves through.
 */
import type { StatusKind } from '@shared/components';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'documents_pending'
  | 'eligible'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'withdrawn'
  | 'enrolled';

/**
 * Statuses a decision has already been taken on. An application in one of these is a
 * record, not a form: the server refuses edits and every transition button is hidden.
 *
 * `deferred` is here because the applicant re-applies for the intake they were deferred
 * to rather than this row being reopened — which is also what lets them past the SSN
 * duplicate guard. See `admissions/service._REVIEWABLE`.
 */
export const DECIDED_APPLICATION_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  'accepted',
  'rejected',
  'deferred',
  'withdrawn',
  'enrolled',
]);

/** An application still working its way through admissions — the complement of the above. */
export function isDecidedApplication(status: ApplicationStatus): boolean {
  return DECIDED_APPLICATION_STATUSES.has(status);
}

/**
 * D33 — `District` and `EnrollmentLoad` now live in `@shared/types/enums`, because the
 * STUDENT record carries both too (asks 3 + 4) and two copies of a closed enum is how one
 * district ends up spelled two ways. Re-exported here so every existing import of them
 * from this module keeps working.
 */
export type { District, EnrollmentLoad } from '@shared/types/enums';
// A re-export does not bring the names into local scope; the shapes below use them.
import type { District, EnrollmentLoad } from '@shared/types/enums';

export type YearOfStudy = 'First' | 'Second';
export type EducationLevel = 'High School' | 'Tertiary';
export type CreditTransferStatus = 'pending' | 'approved' | 'denied';

export type ApplicationDocumentType =
  | 'passport_photo'
  | 'hs_diploma'
  | 'recommendation_form'
  | 'social_security_card'
  | 'course_outline'
  | 'transcript'
  | 'cta'
  | 'other';

export interface ProgramRef {
  id: string;
  code: string;
  name: string;
}

export interface CourseRef {
  id: string;
  code: string;
  name: string;
  credits: number | null;
}

/** Section B · one prior institution. Replaced as a whole set. */
export interface EducationRow {
  id?: string | null;
  institution: string;
  education_level: EducationLevel;
  graduated: boolean;
  graduation_date: string | null;
  sort_order: number;
}

/**
 * Section F · one checklist row. **No file bytes** — object storage is not provisioned
 * (OQ-DB5), and Section F on paper is a tick-list. `received` is the field that carries
 * meaning.
 */
export interface DocumentRow {
  id?: string | null;
  document_type: ApplicationDocumentType;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  received: boolean;
}

export interface CreditTransfer {
  id: string;
  application_id: string;
  external_institution: string;
  external_course_code: string | null;
  external_course_name: string;
  external_credits: number | null;
  external_grade: string | null;
  target_course: CourseRef | null;
  content_equivalency_pct: number | null;
  cta_document_id: string | null;
  transcript_document_id: string | null;
  outline_document_id: string | null;
  status: CreditTransferStatus;
  decided_by_user_id: string | null;
  decided_at: string | null;
  note: string | null;
  /** Whether the ≥75% floor is currently satisfiable — drives the Approve button. */
  meets_equivalency_floor: boolean;
}

export interface ApplicationListItem {
  id: string;
  /** D44 — `APP-YYYY-NNNNN`. Null only on rows written before the backfill. */
  application_number: string | null;
  status: ApplicationStatus;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  school_year: string | null;
  program: ProgramRef | null;
  year_of_study: YearOfStudy | null;
  enrollment_load: EnrollmentLoad | null;
  email: string | null;
  phone: string | null;
  date_accepted: string | null;
  student_code: string | null;
  student_id: string | null;
  created_at: string;
  /** Undecided credit transfers on this application — where the Dean's work is. */
  pending_credit_transfers: number;
}

export interface ApplicationDetail extends ApplicationListItem {
  date_of_birth: string | null;
  ssno: string | null;
  gender: string | null;
  civil_status: string | null;
  religion: string | null;
  has_health_condition: boolean;
  health_condition_note: string | null;
  street: string | null;
  city_town_village: string | null;
  district: District | null;
  mother_name: string | null;
  father_name: string | null;
  nok_name: string | null;
  nok_relationship: string | null;
  nok_phone: string | null;
  atlib_exam: boolean;
  num_csec: number | null;
  finance_name: string | null;
  finance_phone: string | null;
  finance_email: string | null;
  recommendation_received: boolean;
  applicant_signed_at: string | null;
  guardian_signed_at: string | null;
  academic_year_id: string | null;
  enrolment_status: string | null;
  /** D44 — conditions attached to the offer, e.g. "must pass the ATLIB exam by January". */
  conditions_of_admission: string | null;
  comments: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  /** Null until the application is actually edited (D39 `015`). */
  updated_at: string | null;
  education: EducationRow[];
  documents: DocumentRow[];
  credit_transfers: CreditTransfer[];
  /**
   * What still stands between this form and acceptance, in plain sentences. Rendered
   * verbatim: the server is the one that knows the rules, and duplicating them in the
   * browser is how the two start disagreeing.
   */
  blocking_issues: string[];
}

/** Every writable field. All optional — see the module note on drafts. */
export interface ApplicationWritePayload {
  school_year?: string | null;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  date_of_birth?: string | null;
  ssno?: string | null;
  gender?: string | null;
  civil_status?: string | null;
  religion?: string | null;
  phone?: string | null;
  email?: string | null;
  has_health_condition?: boolean | null;
  health_condition_note?: string | null;
  street?: string | null;
  city_town_village?: string | null;
  district?: District | null;
  mother_name?: string | null;
  father_name?: string | null;
  nok_name?: string | null;
  nok_relationship?: string | null;
  nok_phone?: string | null;
  atlib_exam?: boolean | null;
  num_csec?: number | null;
  finance_name?: string | null;
  finance_phone?: string | null;
  finance_email?: string | null;
  recommendation_received?: boolean | null;
  program_id?: string | null;
  year_of_study?: YearOfStudy | null;
  enrollment_load?: EnrollmentLoad | null;
  applicant_signed_at?: string | null;
  guardian_signed_at?: string | null;
  academic_year_id?: string | null;
  enrolment_status?: string | null;
  comments?: string | null;
}

export interface ApplicationCreatePayload extends ApplicationWritePayload {
  first_name: string;
  last_name: string;
  /** Skip the draft state. For a complete form typed in one sitting. */
  submit?: boolean;
}

export interface AcceptPayload {
  academic_year_id?: string | null;
  date_accepted?: string | null;
  /** Defaults to the applicant's own email; required when they gave none. */
  login_email?: string | null;
  temporary_password?: string | null;
  comments?: string | null;
}

export interface AcceptResponse {
  application: ApplicationDetail;
  student_id: string;
  student_number: string;
  /** Shown ONCE, and only when the server generated it. Never re-fetchable. */
  temporary_password: string | null;
  login_email: string | null;
  transferred_course_codes: string[];
}

export interface CreditTransferWritePayload {
  external_institution: string;
  external_course_code?: string | null;
  external_course_name: string;
  external_credits?: number | null;
  external_grade?: string | null;
  target_course_id: string;
  content_equivalency_pct?: number | null;
  cta_document_id?: string | null;
  transcript_document_id?: string | null;
  outline_document_id?: string | null;
  note?: string | null;
}

export interface CreditTransferDecisionPayload {
  status: 'approved' | 'denied';
  content_equivalency_pct?: number | null;
  note?: string | null;
}

export interface ApplicationsListParams {
  page?: number;
  page_size?: number;
  status?: ApplicationStatus;
  search?: string;
  program_id?: string;
}

/** The ≥75% content-equivalency floor (brief §13). Mirrors the server constant. */
export const MIN_EQUIVALENCY_PCT = 75;

/**
 * Status -> badge colour. D44 moved this here from the two screens that each carried a
 * copy: adding four statuses meant editing both, and a `Record<ApplicationStatus, _>` is
 * only a safety net if there is one of it.
 *
 * `eligible` is INFO, not success. The college has not offered anything yet, and colouring
 * it green is how "eligible" starts being read as "in".
 */
export const APPLICATION_STATUS_KIND: Record<ApplicationStatus, StatusKind> = {
  draft: 'neutral',
  submitted: 'info',
  under_review: 'warning',
  documents_pending: 'warning',
  eligible: 'info',
  accepted: 'success',
  rejected: 'error',
  deferred: 'neutral',
  withdrawn: 'neutral',
  enrolled: 'success',
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  // D44. "Waiting on documents" rather than "Documents pending": it names who the ball is
  // with, which is the only thing anyone scanning the queue wants to know.
  documents_pending: 'Waiting on documents',
  eligible: 'Eligible',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deferred: 'Deferred',
  withdrawn: 'Withdrawn',
  enrolled: 'Enrolled',
};

export { DISTRICTS } from '@shared/types/enums';

/**
 * Section F's checklist, in the order the form prints it. The last three are not on
 * Section F — they exist because credit transfer needs a CTA, a transcript and course
 * outlines (brief §13) — so they are labelled as such.
 */
export const DOCUMENT_TYPES: { value: ApplicationDocumentType; label: string }[] = [
  { value: 'passport_photo', label: 'Passport-size photograph' },
  { value: 'hs_diploma', label: 'Copy of high-school diploma' },
  { value: 'recommendation_form', label: 'BAJC recommendation form' },
  { value: 'social_security_card', label: 'Copy of a valid Social Security card' },
  { value: 'course_outline', label: 'Course outlines (credit transfer)' },
  { value: 'transcript', label: 'Original transcript (credit transfer)' },
  { value: 'cta', label: 'Credit Transfer Application (CTA)' },
  { value: 'other', label: 'Other' },
];


/* ────────────────────────────────────────────────────────────────────────────
 * D38 · the PENDING form (`student_profile_temp`)
 *
 * A form the Registrar saved but has not submitted. It is NOT an application yet: it
 * lives in its own table, it is visible only to whoever filed it (and to the Dean), and
 * `POST /pending-applications/{id}/submit` is what turns it into one.
 *
 * The wizard no longer saves per step, so the write payload is the WHOLE form —
 * Sections B and F included, as arrays rather than through their own endpoints.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PendingApplicationListItem {
  id: string;
  /** Always `'pending'`. Present so a row is self-describing in a mixed list. */
  status: string;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  school_year: string | null;
  program: ProgramRef | null;
  year_of_study: YearOfStudy | null;
  enrollment_load: EnrollmentLoad | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  created_by: string | null;
  /** Who filed it. Only meaningful to the Dean — a Registrar sees only their own rows. */
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  /**
   * What would stop this form being submitted, in plain sentences — the SAME rules the
   * submit runs. On the row so the list can say "ready" or "3 things missing" without
   * anyone re-opening the wizard.
   */
  blocking_issues: string[];
}

export interface PendingApplicationDetail extends PendingApplicationListItem {
  date_of_birth: string | null;
  ssno: string | null;
  civil_status: string | null;
  religion: string | null;
  has_health_condition: boolean;
  health_condition_note: string | null;
  street: string | null;
  city_town_village: string | null;
  district: District | null;
  mother_name: string | null;
  father_name: string | null;
  nok_name: string | null;
  nok_relationship: string | null;
  nok_phone: string | null;
  atlib_exam: boolean;
  num_csec: number | null;
  finance_name: string | null;
  finance_phone: string | null;
  finance_email: string | null;
  recommendation_received: boolean;
  applicant_signed_at: string | null;
  guardian_signed_at: string | null;
  academic_year_id: string | null;
  enrolment_status: string | null;
  comments: string | null;
  /** Read back out of the JSON columns, in the same shape the real child tables read in. */
  education: EducationRow[];
  documents: DocumentRow[];
}

/**
 * The whole form in one body. Names required, everything else optional — a pending form
 * is allowed to be half-typed, which is the only reason the table exists.
 */
export interface PendingApplicationWritePayload extends ApplicationWritePayload {
  first_name: string;
  last_name: string;
  education: EducationRow[];
  documents: DocumentRow[];
}

export interface PendingApplicationsListParams {
  page?: number;
  page_size?: number;
  search?: string;
}
