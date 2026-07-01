import { ApiError } from './client';

/**
 * Maps the backend's closed error-code vocabulary (api-specification.md §1.3) to
 * human, actionable copy. The server is the authority on WHICH code applies; this
 * only translates known codes into UX strings.
 *
 * Lives in shared/api because the code vocabulary is global (spans Settings, Subjects,
 * and future modules). Unknown codes fall back to the server-provided message (already
 * carried on `ApiError.message`), then a generic default — so we never show a raw code.
 */
const ERROR_COPY: Record<string, string> = {
  // Subjects (api-spec §5b)
  duplicate_subject_name: 'A subject with this name already exists. Choose a different name.',
  duplicate_subject_code: 'A subject with this code already exists. Choose a different code.',
  subject_in_use:
    'This subject is used by one or more classes and cannot be deleted. Retire it instead.',
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
