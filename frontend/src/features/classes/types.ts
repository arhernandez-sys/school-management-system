/**
 * Classes module wire types (api-spec §5). These mirror the MSW handler response
 * shapes in `mocks/handlers/classes.ts` exactly (snake_case). The Classes endpoints
 * are not in the auth-only OpenAPI surface yet, so there are no orval-generated
 * models to import — these hand-authored types are the local contract until they are.
 *
 * **D29** — a class is one SUBJECT CLASS ("Math-1"), not a multi-subject homeroom.
 * Students enrol into each subject class individually, so a student has MANY classes.
 * Changes from the homeroom contract:
 *   * `ClassListItem`/`ClassDetail` gained `subject`, `class_subject_id`, `teachers`,
 *     `lead_teacher_id`, `meetings` — a row is unreadable without them, and fetching
 *     them per row would be N+1 from the client.
 *   * `subject_count` is gone (always 1).
 *   * `EnrollmentResult.transferred` is gone. Enrolling is additive now; it no longer
 *     silently unenrols the student from their other classes.
 */
import type { Page } from '@shared/types/api';

export interface SubjectRef {
  id: string;
  name: string;
  code: string;
}

export interface TeacherRef {
  id: string;
  full_name: string;
}

export interface StudentRef {
  id: string;
  full_name: string;
  student_number: string;
}

export interface AcademicYearRef {
  id: string;
  name: string;
  status: string;
}

/** ISO weekday of a meeting: 1 = Monday … 5 = Friday. Weekend is not representable. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5;

/** One weekly meeting of a subject class — "Mon 08:00–09:30, Room A". */
export interface ClassMeeting {
  id: string;
  day_of_week: DayOfWeek;
  /** "HH:MM:SS" as served. */
  start_time: string;
  end_time: string;
  room: string | null;
}

/** A meeting as submitted by PUT /classes/{id}/meetings (no id — it's a replace). */
export interface ClassMeetingInput {
  day_of_week: DayOfWeek;
  /** "HH:MM" is accepted; the server normalizes. */
  start_time: string;
  end_time: string;
  room?: string | null;
}

/**
 * A timetable clash. Advisory ONLY — the write that produced it succeeded (warn-only,
 * matching the over-capacity precedent). `message` is server-rendered so the identical
 * sentence appears in the schedule tab and the enrol dialog.
 */
export interface ScheduleConflict {
  kind: 'teacher' | 'room' | 'student';
  /** The clashing party: teacher name, room label, or student name. */
  label: string;
  with_class_id: string;
  with_class_name: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  message: string;
}

/** GET + PUT /classes/{id}/meetings. */
export interface MeetingsResult {
  meetings: ClassMeeting[];
  conflicts: ScheduleConflict[];
}

/**
 * Row in GET /classes — one subject class.
 *
 * `subject` / `class_subject_id` are nullable only for a pre-D29 row that never had a
 * subject attached; anything created through the current UI always has both.
 */
export interface ClassListItem {
  id: string;
  name: string;
  /** The year group this class is FOR ("Lower 6") — a filter, not the roster's level. */
  grade_level: string;
  section: string | null;
  capacity: number | null;
  enrolled_count: number;
  is_archived: boolean;
  subject: SubjectRef | null;
  class_subject_id: string | null;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  meetings: ClassMeeting[];
}

/** GET /classes/{id}. `over_capacity` is the warn-only state flag (D-Q6). */
export interface ClassDetail {
  id: string;
  name: string;
  grade_level: string;
  section: string | null;
  capacity: number | null;
  academic_year: AcademicYearRef;
  enrolled_count: number;
  over_capacity: boolean;
  is_archived: boolean;
  subject: SubjectRef | null;
  class_subject_id: string | null;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  meetings: ClassMeeting[];
}

/** Row in GET /classes/{id}/subjects. */
export interface ClassSubjectItem {
  class_subject_id: string;
  subject: SubjectRef;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  assessment_count: number;
  is_active: boolean;
  actionable_by_caller: boolean;
}

/** Row in GET /classes/{id}/roster. */
export interface RosterEntry {
  enrollment_id: string;
  student: StudentRef;
  enrolled_at: string;
  unenrolled_at: string | null;
}

/**
 * Result of POST /classes/{id}/enrollments.
 *
 * `transferred` is GONE (D29). It reported the old behaviour where enrolling a student
 * closed their enrollment everywhere else in the semester — which in a sixth form is
 * data loss, since a student legitimately takes Math AND Biology. Enrolling is now
 * purely additive and `schedule_conflicts` is what the office needs to see instead.
 */
export interface EnrollmentResult {
  enrolled: RosterEntry[];
  /** Per-mutation feedback: the enroll pushed the class over capacity (warn-only). */
  over_capacity_warning: boolean;
  /** Timetable clashes the new enrollment creates. Warning only — it still enrolled. */
  schedule_conflicts: ScheduleConflict[];
}

/**
 * PUT /classes/{id}/subjects/{csId}/teachers request body.
 *
 * REPLACES the offering's whole teacher set (it is a PUT, not a PATCH). An empty
 * `teacher_ids` is valid and removes every teacher. `lead_teacher_id` must be a member
 * of `teacher_ids` (422 `validation_error` otherwise) and defaults server-side to
 * `teacher_ids[0]` when null.
 */
export interface TeacherAssignBody {
  teacher_ids: string[];
  lead_teacher_id: string | null;
}

/**
 * PUT /classes/{id}/meetings request body — REPLACES the whole week.
 *
 * An empty array is valid and clears the schedule. Replace-the-set (rather than
 * per-meeting POST/PATCH/DELETE) means a retimed week cannot half-apply.
 */
export interface MeetingsReplaceBody {
  meetings: ClassMeetingInput[];
}

/**
 * POST /classes request body.
 *
 * `subject_id` is REQUIRED (D29) — a class with no subject cannot be graded, scheduled
 * or enrolled into. `teacher_ids` and `meetings` are optional but accepted here so
 * "Math-1, Mr. Smith, Room A, Mon 08:00" is one request instead of three.
 */
export interface ClassCreateBody {
  name: string;
  subject_id: string;
  grade_level: string;
  section?: string | null;
  capacity?: number | null;
  academic_year_id?: string;
  teacher_ids?: string[];
  lead_teacher_id?: string | null;
  meetings?: ClassMeetingInput[];
}

export interface ClassListParams {
  academic_year_id?: string;
  grade_level?: string;
  /** Narrow to classes teaching one subject (e.g. both Math classes). */
  subject_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
  sort?: string;
}

export type ClassListResponse = Page<ClassListItem>;
