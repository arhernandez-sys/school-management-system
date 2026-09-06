import { ApiError } from './client';

/**
 * Maps the backend's closed error-code vocabulary (api-specification.md §1.3) to
 * human, actionable copy. The server is the authority on WHICH code applies; this
 * only translates known codes into UX strings.
 *
 * Lives in shared/api because the code vocabulary is global (spans Settings, the course
 * catalog, offerings, and every other module). Unknown codes fall back to the
 * server-provided message (already carried on `ApiError.message`), then a generic default
 * — so we never show a raw code.
 *
 * ⚠️ A key here must match a code the server actually emits. A stale key is invisible: the
 * lookup misses, the server's own sentence is shown instead, and nothing warns. That is
 * why D31's `duplicate_subject_* → duplicate_course_*` rename had to land in both files at
 * once.
 */
const ERROR_COPY: Record<string, string> = {
  // Course catalog (api-spec §5b). D31 renamed these three with the `/subjects` →
  // `/courses` path; a course is the CATALOG entry, an offering is a scheduled instance.
  duplicate_course_name: 'A course with this name already exists. Choose a different name.',
  duplicate_course_code: 'A course with this code already exists. Choose a different code.',
  course_in_use:
    'This course is scheduled by one or more offerings and cannot be deleted. Retire it instead.',
  // Offerings (api-spec §5). The identity is (course, term, section_code), so a clash
  // means that exact combination exists — not that the course is taken. Leaving the
  // section blank counts as a section, which is why a second blank one also collides.
  duplicate_offering:
    'This course is already offered in that session with the same section code. Use a different section code.',
  offering_not_found: 'That course offering no longer exists, or you do not have access to it.',
  offering_has_history:
    'This offering already has assessments or attendance recorded. Archive it instead of deleting it.',
  course_not_found: 'That course is no longer in the catalog. Pick another one.',
  semester_not_found: 'That session no longer exists. Pick another one.',
  year_archived: 'That academic year is archived and cannot be changed.',
  semester_mismatch: 'That offering runs in a different session from the enrolment you are making.',
  // Academic structure
  active_year_exists: 'An active academic year already exists. Archive it before creating a new one.',
  year_already_archived: 'This academic year is already archived.',
  no_active_semester: 'No active semester is set. Create and activate an academic year to continue.',
  invalid_semester_count: 'An academic year must have exactly two semesters.',
  // Grading scale
  grading_bands_invalid: 'The grading bands must cover 0–100 with no gaps or overlaps.',
  scale_frozen: 'This grading scale belongs to an archived year and is read-only.',
  // Users
  role_change_forbidden: 'You do not have permission to change this user’s role or status.',
  duplicate_email: 'An account with this email already exists.',
  // Admissions (D44). The two SSN codes are deliberately DIFFERENT sentences: one points
  // at an application to finish, the other at a student who already exists, and telling
  // the Registrar which of the two they are looking at is the whole value of the check.
  // Both fall through to the server's own message, which names the specific record — the
  // generic copy here is the safety net, not the primary.
  duplicate_ssn:
    'An application for this Social Security number is already open. Finish or close it before filing another.',
  duplicate_ssn_student:
    'This Social Security number belongs to a student already enrolled here. Check the student record before filing a new application.',
  application_decided:
    'A decision has already been recorded on this application, so it can no longer be edited.',
  application_not_decidable:
    'This application is not at a stage where that decision can be taken.',
  application_not_reviewable:
    'Only a submitted or under-review application can be moved to that stage.',
  application_not_accepted: 'Only an accepted application can be marked enrolled.',
  application_no_student:
    'This application has no student record yet, so it cannot be marked enrolled. Accept it first.',
  // Classrooms (D44).
  duplicate_room_code: 'A classroom with this code already exists. Choose a different code.',
  classroom_in_use:
    'This room is assigned to course offerings. Reassign them first, or set the room Inactive instead of deleting it.',
  classroom_not_found: 'That classroom no longer exists. Pick another one.',
  classroom_status_not_settable:
    'A room is set Active or Inactive. In-Use, Available and Occupied are worked out from the timetable.',
  // The mid-session freeze (D33/D44). The SERVER says "mid-term" in these three; the
  // whole frontend says "mid-session". Without these overrides the server's wording
  // reaches the user verbatim and the app appears to have two names for one rule.
  midterm_frozen:
    'Grades are currently closed for this session and will accept new grades once the mid-session freeze ends.',
  midterm_window_open:
    'Grades are closed while the mid-session freeze is running. Revisions open when it ends.',
  no_midterm_window:
    'This session has no mid-session period. The Dean sets one in Settings → Academic structure.',
  duplicate_username: 'This username is already taken.',
  // Generic
  validation_error: 'Some fields need attention. Please review and try again.',
  forbidden: 'You do not have permission to perform this action.',
};

/** Resolve a friendly message from any thrown error (ApiError or otherwise). */
export function apiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof ApiError) {
    return ERROR_COPY[error.code] ?? error.message ?? fallback;
  }
  return fallback;
}

/** True when the error is an ApiError carrying the given code. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

/** Field-level errors from a 422, keyed by field name. */
export function fieldErrorsFrom(error: unknown): Record<string, string[]> | undefined {
  return error instanceof ApiError ? error.fields : undefined;
}
