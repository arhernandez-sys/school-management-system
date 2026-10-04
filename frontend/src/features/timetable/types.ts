/**
 * Timetable module wire types (D29, FR-SCH-03..05). Hand-authored, snake_case, mirroring
 * `backend/app/modules/timetable/schemas.py` — the Timetable endpoints are not in the
 * orval-covered surface (`orval.config.ts` generates auth/health/settings/courses only).
 *
 * The response is pre-bucketed by weekday rather than a flat meeting list: every consumer
 * renders five columns (or five day groups on mobile), and an empty day is explicit —
 * a flat list makes "Wednesday has nothing" indistinguishable from "Wednesday is missing
 * from the data".
 *
 * **D31 collapsed four fields into one `offering`.** An entry used to carry
 * `class_id` + `class_name` + `class_subject_id` + `subject`: four fields describing two
 * rows. A homeroom and the subject it taught are the same row now, so `class_id` and
 * `class_subject_id` had become the same UUID sent twice under different names, and
 * `class_name` had no column to come from. One `OfferingRef` says all of it, and it is the
 * SAME ref the offerings list, the gradebook picker and the student profile use.
 */
import type { OfferingRef, TeacherRef } from '@shared/types/api';
import type { DayOfWeek, OfferingMeeting } from '@features/offerings/types';

export type { DayOfWeek };

/** One meeting of one offering, as it appears in a week view. */
export interface TimetableEntry {
  meeting_id: string;
  offering: OfferingRef;
  /**
   * Who teaches it. On a student's timetable, their lecturer(s); on a lecturer's own
   * timetable, their co-lecturers (an offering may have more than one — D16).
   */
  teachers: TeacherRef[];
  /** Per MEETING, not per offering — the same course can meet in a lab on another day. */
  room: string | null;
  day_of_week: DayOfWeek;
  /** "HH:MM:SS" as served. */
  start_time: string;
  end_time: string;
}

/** An offering the viewer belongs to that has no meetings set yet. */
export interface UnscheduledOffering {
  offering: OfferingRef;
  teachers: TeacherRef[];
}

/** One weekday. Always present, even with no entries. */
export interface TimetableDay {
  day_of_week: DayOfWeek;
  /** "Monday" — server-supplied so the client is not a second place that maps 1→Monday. */
  day_name: string;
  entries: TimetableEntry[];
}

/** GET /timetable/me and GET /timetable/students/{id}. */
export interface TimetableView {
  /** Whose week this is — set for the P/S per-student view, null for a lecturer's own. */
  student: { id: string; full_name: string; student_number: string } | null;
  academic_year_id: string | null;
  days: TimetableDay[];
  /**
   * Offerings the viewer belongs to with no meetings yet. Listed separately so an offering
   * cannot silently vanish from the timetable — "my Biology course is missing" would
   * otherwise be indistinguishable from "I'm not enrolled in Biology".
   */
  unscheduled: UnscheduledOffering[];
}

/** Re-exported so timetable consumers don't reach into the Offerings module for it. */
export type { OfferingMeeting };
