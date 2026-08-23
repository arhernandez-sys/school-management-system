/**
 * Offerings module wire types (api-spec §5, `GET/POST /offerings`).
 *
 * **D31** — this file used to describe `classes`: a HOMEROOM scoped to an academic YEAR,
 * carrying `name`, `grade_level`, `section`, `homeroom_label`, plus a `class_subjects`
 * join because one homeroom taught ~7 subjects. All of that is gone. A COURSE OFFERING is
 * one course, in one semester, with an optional section code:
 *
 *   * **Identity is `(course_id, semester_id, section_code)`** — enforced by a unique
 *     index, which is what makes "MATH1110-01 and MATH1110-02 in Semester 1" and "the
 *     same course again in Semester 2" both expressible. The year-scoped model could
 *     express neither.
 *   * **There is no `name`.** The label derives from course code + section + term, and it
 *     is computed SERVER-side and sent as `label`. Do not rebuild it here.
 *   * **There is no `grade_level`.** It went with the homeroom; it was
 *     `varchar(50) NOT NULL`, so every offering had to declare a Form.
 *   * **`ClassSubjectItem` is gone**, and with it the Subjects tab, `attach_subject` /
 *     `detach_subject`, and the 15-endpoint surface (now 12). One offering teaches one
 *     course, so there is nothing to attach.
 *   * `semester_id` replaces `academic_year_id`. An offering stores no year — the year is
 *     a hop through its semester, which is why `OfferingDetail` carries `academic_year`
 *     but `OfferingListItem` does not.
 *
 * The shared refs (`OfferingRef`, `CourseRef`, `SemesterRef`, `TeacherRef`, `StudentRef`,
 * `AcademicYearRef`) live in `@shared/types/api` — see the consolidation note there.
 */
import type {
  AcademicYearRef,
  CourseRef,
  Page,
  SemesterRef,
  StudentRef,
  TeacherRef,
} from '@shared/types/api';

export type { AcademicYearRef, CourseRef, SemesterRef, StudentRef, TeacherRef };

/** ISO weekday of a meeting: 1 = Monday … 5 = Friday. Weekend is not representable. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5;

/** One weekly meeting of an offering — "Mon 08:00–09:30, Room A". */
export interface OfferingMeeting {
  id: string;
  day_of_week: DayOfWeek;
  /** "HH:MM:SS" as served. */
  start_time: string;
  end_time: string;
  /**
   * Room is per MEETING, not per offering: one course legitimately meets in a lecture
   * room on Monday and a lab on Wednesday, which is why `course_offerings` has no `room`.
   */
  room: string | null;
}

/** A meeting as submitted by PUT /offerings/{id}/meetings (no id — it's a replace). */
export interface OfferingMeetingInput {
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
  with_offering_id: string;
  /** The other offering's server-computed label — print it, do not rebuild it. */
  with_offering_label: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  message: string;
}

/** GET + PUT /offerings/{id}/meetings. */
export interface MeetingsResult {
  meetings: OfferingMeeting[];
  conflicts: ScheduleConflict[];
}

/**
 * Row in GET /offerings — one course offering.
 *
 * `course` / `semester` are nullable only for a legacy row whose catalog entry or term
 * could not be resolved; anything created through the current UI always has both. The API
 * returns `teachers` and `meetings` ON the row so no column costs a follow-up request.
 */
export interface OfferingListItem {
  id: string;
  /** Server-computed "MATH1110-01 · Semester 1". The only label a screen should print. */
  label: string;
  course: CourseRef | null;
  semester: SemesterRef | null;
  section_code: string | null;
  capacity: number | null;
  enrolled_count: number;
  is_archived: boolean;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  meetings: OfferingMeeting[];
  /** True when the CALLER may write to this offering (teacher ownership, P/S always). */
  actionable_by_caller: boolean;
}

/** GET /offerings/{id}. `over_capacity` is the warn-only state flag (D-Q6). */
export interface OfferingDetail {
  id: string;
  label: string;
  course: CourseRef | null;
  semester: SemesterRef | null;
  /** Resolved THROUGH the semester — an offering row stores no year (D31). */
  academic_year: AcademicYearRef | null;
  section_code: string | null;
  capacity: number | null;
  enrolled_count: number;
  over_capacity: boolean;
  is_archived: boolean;
  teachers: TeacherRef[];
  lead_teacher_id: string | null;
  meetings: OfferingMeeting[];
  assessment_count: number;
  actionable_by_caller: boolean;
}

/**
 * How a student is sitting one offering — the client's `coursestatus` (D35).
 *
 * Mirrors `app/common/enums.py::EnrollmentStatus`. The column has existed since
 * `005_tertiary.sql` but was mapped and nothing else until D35: no endpoint set it and no
 * calculation read it.
 *
 * `audit` and the two `withdraw_*` values all mean **no credit and out of the GPA**, and
 * the transcript prints `AU` / `W/P` / `W/F` against them. That last part is the point —
 * a permanent record that omits the course a student withdrew from is not a transcript.
 */
export type EnrollmentStatus = 'enrolled' | 'audit' | 'withdraw_passing' | 'withdraw_failing';

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  enrolled: 'Enrolled',
  audit: 'Audit',
  withdraw_passing: 'Withdrew passing',
  withdraw_failing: 'Withdrew failing',
};

/** The short form the transcript prints. */
export const ENROLLMENT_STATUS_NOTATION: Record<EnrollmentStatus, string | null> = {
  enrolled: null,
  audit: 'AU',
  withdraw_passing: 'W/P',
  withdraw_failing: 'W/F',
};

export const ENROLLMENT_STATUS_OPTIONS: EnrollmentStatus[] = [
  'enrolled',
  'audit',
  'withdraw_passing',
  'withdraw_failing',
];

/** Row in GET /offerings/{id}/roster. */
export interface RosterEntry {
  enrollment_id: string;
  student: StudentRef;
  enrolled_at: string;
  unenrolled_at: string | null;
  /** D35 — how they are sitting it. `enrolled` is the ordinary case. */
  enrollment_status: EnrollmentStatus;
}

/** PATCH /offerings/{id}/enrollments/{enrollmentId} body (D35). */
export interface EnrollmentStatusBody {
  enrollment_status: EnrollmentStatus;
  /** Recorded on the audit row, not on the enrolment — there is no column for it. */
  reason?: string | null;
}

/**
 * Result of POST /offerings/{id}/enrollments.
 *
 * Enrolling is purely additive: a student legitimately takes several courses in a term,
 * so it never closes their other enrollments. `schedule_conflicts` is what the office
 * needs to see instead, and it does NOT fail the write.
 */
export interface EnrollmentResult {
  enrolled: RosterEntry[];
  /** Per-mutation feedback: the enroll pushed the offering over capacity (warn-only). */
  over_capacity_warning: boolean;
  /** Timetable clashes the new enrollment creates. Warning only — it still enrolled. */
  schedule_conflicts: ScheduleConflict[];
}

/**
 * PUT /offerings/{id}/teachers request body.
 *
 * REPLACES the offering's whole teacher set (it is a PUT, not a PATCH). An empty
 * `teacher_ids` is valid and removes every teacher. `lead_teacher_id` must be a member
 * of `teacher_ids` (422 `validation_error` otherwise) and defaults server-side to
 * `teacher_ids[0]` when null.
 *
 * **D31** — the path lost its homeroom hop. It used to be
 * `PUT /classes/{class_id}/subjects/{cs_id}/teachers`, threading two ids to reach one
 * gradebook's lecturers.
 */
export interface TeacherAssignBody {
  teacher_ids: string[];
  lead_teacher_id: string | null;
}

/**
 * PUT /offerings/{id}/meetings request body — REPLACES the whole week.
 *
 * An empty array is valid and clears the schedule. Replace-the-set (rather than
 * per-meeting POST/PATCH/DELETE) means a retimed week cannot half-apply.
 */
export interface MeetingsReplaceBody {
  meetings: OfferingMeetingInput[];
}

/**
 * POST /offerings request body.
 *
 * `course_id` is REQUIRED — an offering IS an offering OF a course. `semester_id` defaults
 * server-side to the active semester. `section_code` is optional and null means "the only
 * section"; a SECOND null-section offering of the same course in the same term is refused
 * (409), which is what the `COALESCE` in the unique index buys.
 *
 * `teacher_ids` and `meetings` are optional but accepted here so "MATH1110-01, Mr. Smith,
 * Room A, Mon 08:00" is one request instead of three.
 */
export interface OfferingCreateBody {
  course_id: string;
  semester_id?: string | null;
  section_code?: string | null;
  capacity?: number | null;
  teacher_ids?: string[];
  lead_teacher_id?: string | null;
  meetings?: OfferingMeetingInput[];
}

/**
 * PATCH /offerings/{id} request body.
 *
 * Only these three are mutable, and the omission is deliberate: the course and the
 * semester are the offering's IDENTITY, so changing either would silently move every
 * assessment, grade and enrollment attached to it into a different course or term. The
 * request body simply does not accept them — archive the offering and create the right one.
 */
export interface OfferingUpdateBody {
  section_code?: string | null;
  capacity?: number | null;
  is_archived?: boolean | null;
}

export interface OfferingListParams {
  search?: string;
  /** Filters through the offering's semester — an offering has no year of its own. */
  academic_year_id?: string;
  semester_id?: string;
  /** Narrow to offerings of one catalog course (e.g. both sections of MATH1110). */
  course_id?: string;
  page?: number;
  page_size?: number;
  sort?: string;
}

export type OfferingListResponse = Page<OfferingListItem>;
