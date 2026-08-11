/**
 * Timetable module wire types (D29, FR-SCH-03..05). Hand-authored, snake_case, mirroring
 * `backend/app/modules/timetable/schemas.py` — the Timetable endpoints are not in the
 * orval-covered surface yet.
 *
 * The response is pre-bucketed by weekday rather than a flat meeting list: every consumer
 * renders five columns (or five day groups on mobile), and an empty day is explicit —
 * a flat list makes "Wednesday has no classes" indistinguishable from "Wednesday is
 * missing from the data".
 */
import type { ClassMeeting, DayOfWeek, SubjectRef, TeacherRef } from '@features/classes/types';

export type { DayOfWeek };

/** One meeting of one subject class, as it appears in a week view. */
export interface TimetableEntry {
  meeting_id: string;
  class_id: string;
  class_name: string;
  class_subject_id: string;
  subject: SubjectRef;
  /**
   * Who teaches it. On a student's timetable, their teacher(s); on a teacher's own
   * timetable, their co-teachers (a class may have more than one — D16).
   */
  teachers: TeacherRef[];
  room: string | null;
  day_of_week: DayOfWeek;
  /** "HH:MM:SS" as served. */
  start_time: string;
  end_time: string;
}

/** A class the viewer belongs to that has no meetings set yet. */
export interface UnscheduledClass {
  class_id: string;
  class_name: string;
  class_subject_id: string;
  subject: SubjectRef;
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
  /** Whose week this is — set for the P/S per-student view, null for a teacher's own. */
  student: { id: string; full_name: string; student_number: string } | null;
  academic_year_id: string | null;
  days: TimetableDay[];
  /**
   * Classes the viewer belongs to with no meetings yet. Listed separately so a class
   * cannot silently vanish from the timetable — "my Biology class is missing" would
   * otherwise be indistinguishable from "I'm not enrolled in Biology".
   */
  unscheduled: UnscheduledClass[];
}

/** Re-exported so timetable consumers don't reach into the Classes module for it. */
export type { ClassMeeting };
