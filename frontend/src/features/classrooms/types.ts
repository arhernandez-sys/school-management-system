/**
 * Classrooms (D44) — the physical rooms, from the client's `sims_10` dump.
 *
 * Before D44 the system had no idea any room existed: `class_meetings.room` was free text
 * typed per meeting, so "Room A", "room a" and "A" were three rooms, none of them
 * capacity-checked and none of them listable.
 *
 * ⚠️ THIS DOES NOT YET REPLACE `class_meetings.room`. Both exist, and the free-text one is
 * still what the timetable renders. Which of the two wins is a decision the timetable work
 * has to make; until then, two things describe the same fact.
 */

/** The whole vocabulary the column can hold — the client's own, spelling corrected. */
export type ClassroomStatus = 'Active' | 'Inactive' | 'In-Use' | 'Available' | 'Occupied';

/**
 * The only two a room may be SET to.
 *
 * The other three describe live OCCUPANCY, which the timetable derives: a room marked
 * `Occupied` on Monday morning is wrong by Monday afternoon. The server refuses them on a
 * write with `classroom_status_not_settable`; this is the client-side half of the same
 * rule, so the form does not offer what the server will reject.
 */
export const SETTABLE_CLASSROOM_STATUSES: ReadonlyArray<ClassroomStatus> = [
  'Active',
  'Inactive',
];

export const CLASSROOM_STATUS_LABEL: Record<ClassroomStatus, string> = {
  Active: 'Active',
  Inactive: 'Inactive',
  'In-Use': 'In use',
  Available: 'Available',
  Occupied: 'Occupied',
};

/** Minimal room, as embedded on an offering. */
export interface ClassroomRef {
  id: string;
  room_code: string;
  building: string;
  /** `A-101 · Main Block`, built server-side so no client assembles a second version. */
  label: string;
}

export interface ClassroomListItem {
  id: string;
  room_code: string;
  building: string;
  /** `0` means "not recorded", not "a room with no chairs". */
  capacity: number;
  room_type: string | null;
  status: ClassroomStatus;
  label: string;
  /** Live offerings scheduled here. The delete confirmation needs it. */
  offering_count: number;
}

export interface ClassroomDetail extends ClassroomListItem {
  created_on: string;
  /** NULL until edited — the 015 convention. */
  edited_on: string | null;
}

/** Create and update share a body; update applies only the keys present. */
export interface ClassroomWritePayload {
  room_code?: string;
  building?: string;
  capacity?: number | null;
  room_type?: string | null;
  status?: ClassroomStatus;
}

export interface ClassroomsListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: ClassroomStatus;
}
