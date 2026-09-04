import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  assessmentsForOffering,
  compareOfferings,
  currentDemoStudent,
  currentDemoTeacher,
  currentDemoHodTeacher,
  demoHodOfferingIds,
  getActiveSemester,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  getTeacher,
  meetingsForOffering,
  offeringLabel,
  offeringsOwnedByTeacher,
  paginate,
  rosterFor,
  unmetPrerequisites,
  yearIdOfOffering,
} from '@shared/api/mocks/demo/dataset';
import type { DemoOffering, DemoStudent } from '@shared/api/mocks/demo/dataset';
import type { EnrollmentStatus } from '@features/offerings/types';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the OFFERINGS module (api-spec §5 Module 5) — DEMO.
 *
 * Backs features/offerings/** offline against the shared demo dataset. Response shapes
 * mirror the api-spec §5 models (OfferingListItem / OfferingDetail / RosterEntry /
 * MeetingsResult / EnrollmentResult). Reads are the focus; enrol, withdraw, meetings and
 * lecturer-assignment writes mutate DEMO_DATASET in place (single-session demo, per
 * selectors.ts contract).
 *
 * **D31 — what changed here, and why the file got smaller.**
 *
 * The surface went from 15 endpoints to 12. Three are GONE, not renamed:
 * `GET`/`POST /classes/{id}/subjects` and `DELETE /classes/{id}/subjects/{csId}` described
 * attaching a subject to a homeroom — a concept that no longer exists, since an offering IS
 * an offering of one course, fixed at creation. `already_offered` and `subject_not_set` went
 * with them: neither state is reachable.
 *
 * The teacher assignment lost a path segment (`PUT /offerings/{id}/teachers`), because
 * owning "this offering" and owning "this offering's course" are the same question now.
 *
 * Every response carries the SERVER-DERIVED `label` from `offeringLabel()`. Nothing here
 * assembles that string itself — that is the single-derivation rule the whole refactor turns
 * on, and a handler that formatted its own would be the first place the demo diverged.
 *
 * Capacity is warn-only (D-Q6): over-capacity never blocks — it surfaces as `over_capacity`
 * (state) on detail/list and `over_capacity_warning` (action result) on enrol. A `capacity`
 * of `null` means NO LIMIT and can never be over. Archived offerings reject writes with 409
 * `year_archived` (FR-CLS-06).
 *
 * ⚠️ Do NOT edit handlers/index.ts — `offeringsHandlers` is wired in there already.
 */
const D = DEMO_DATASET;

/** Acting role from the demo session cookie (same local helper the other handlers use). */
function sessionRole(cookies: Record<string, string>): string {
  return cookies['sis_mock_session'] ?? 'principal';
}

// ── Response shapers (snake_case wire format) ──────────────────────────────────
function courseRef(courseId: string) {
  const c = getCourse(courseId);
  return c
    ? { id: c.id, name: c.name, code: c.code, credits: c.credits }
    : { id: courseId, name: 'Unknown course', code: null, credits: null };
}

function semesterRef(semesterId: string) {
  const s = getSemester(semesterId);
  return s ? { id: s.id, name: s.name, sequence: s.sequence, is_active: s.is_active } : null;
}

function teacherRef(teacherId: string) {
  const t = getTeacher(teacherId);
  return {
    id: teacherId,
    staff_number: t?.staff_number ?? '',
    full_name: t?.full_name ?? 'Unknown lecturer',
  };
}

function studentRef(student: DemoStudent) {
  return {
    id: student.id,
    student_number: student.student_number,
    full_name: student.full_name,
  };
}

function meetingItem(m: {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room: string | null;
}) {
  return {
    id: m.id,
    day_of_week: m.day_of_week,
    start_time: m.start_time,
    end_time: m.end_time,
    room: m.room,
  };
}

/** True when this offering is over its capacity. A `null` capacity is never over. */
function isOverCapacity(offering: DemoOffering, enrolled: number): boolean {
  return offering.capacity != null && offering.capacity > 0 && enrolled > offering.capacity;
}

/**
 * The shared core of the list and detail shapes, so the two cannot disagree.
 *
 * The real API attaches course / lecturers / meetings to BOTH: an offering row is
 * unreadable without them, and fetching them per row would be N+1 from the client.
 */
function offeringCore(offering: DemoOffering) {
  return {
    id: offering.id,
    label: offeringLabel(offering),
    course: courseRef(offering.course_id),
    semester: semesterRef(offering.semester_id),
    section_code: offering.section_code,
    capacity: offering.capacity,
    enrolled_count: rosterFor(offering.id).length,
    is_archived: offering.is_archived,
    teachers: offering.teacher_ids.map(teacherRef),
    lead_teacher_id: offering.lead_teacher_id,
    meetings: meetingsForOffering(offering.id).map(meetingItem),
    // P/S manage everything in the demo (the SPA still hides controls for non-writers).
    actionable_by_caller: true,
  };
}

function offeringListItem(offering: DemoOffering) {
  return offeringCore(offering);
}

function offeringDetail(offering: DemoOffering) {
  const yearId = yearIdOfOffering(offering.id);
  const year = yearId ? D.academic_years.find((y) => y.id === yearId) : undefined;
  const enrolled = rosterFor(offering.id).length;
  return {
    ...offeringCore(offering),
    // Resolved THROUGH the semester — an offering row carries no year (D31).
    academic_year: year ? { id: year.id, name: year.name, status: year.status } : null,
    over_capacity: isOverCapacity(offering, enrolled),
    assessment_count: assessmentsForOffering(offering.id).length,
  };
}

function rosterEntry(offering: DemoOffering, student: DemoStudent) {
  const enr = D.enrollments.find(
    (e) =>
      e.student_id === student.id &&
      e.offering_id === offering.id &&
      e.semester_id === offering.semester_id &&
      !e.unenrolled_at,
  );
  return {
    enrollment_id: enr?.id ?? `enr-${offering.id}-${student.id}`,
    student: studentRef(student),
    enrolled_at: enr?.enrolled_at ?? '',
    unenrolled_at: enr?.unenrolled_at ?? null,
    // D35 — the client's `coursestatus`. `enrolled` when there is no row to read it from,
    // which is the same default the column carries server-side.
    enrollment_status: enr?.enrollment_status ?? 'enrolled',
  };
}

/** Reject writes to an archived offering (FR-CLS-06 → 409 year_archived). */
function notWritable(offering: DemoOffering): boolean {
  if (offering.is_archived) return true;
  return yearArchived(offering);
}

/**
 * The YEAR half of the check above, on its own.
 *
 * `PATCH /offerings/{id}` needs this one and not the offering flag, because it is the
 * endpoint that OWNS `is_archived`: refusing it on an archived offering makes archiving a
 * one-way door, since the request that would clear the flag is refused for having it set.
 * A closed year still refuses everything (D41; mirrors `_assert_year_writable`'s
 * `allow_archived_offering`).
 */
function yearArchived(offering: DemoOffering): boolean {
  const yearId = yearIdOfOffering(offering.id);
  return D.academic_years.find((y) => y.id === yearId)?.status === 'archived';
}

/** "Mon 08:00–09:30" — matches the server-rendered conflict messages. */
const DAY_SHORT: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
function slotLabel(day: number, start: string, end: string): string {
  return `${DAY_SHORT[day] ?? `Day ${day}`} ${start.slice(0, 5)}–${end.slice(0, 5)}`;
}
/** Half-open overlap: back-to-back meetings (09:30 end, 09:30 start) do NOT clash. */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Clashes between one offering's week and what a student already sits (warn-only).
 *
 * The real API computes this server-side and ships a rendered `message`, so the mock does
 * the same rather than letting the UI format it — otherwise the demo and the live app would
 * word the same warning differently.
 *
 * Scoped to the offering's OWN semester: a Semester-1 slot cannot clash with a Semester-2
 * one, and comparing across terms would invent warnings for weeks that never coexist.
 */
function scheduleConflictsForStudent(studentId: string, offering: DemoOffering) {
  const mine = meetingsForOffering(offering.id);
  if (mine.length === 0) return [];
  const student = getStudent(studentId);
  const otherOfferingIds = D.enrollments
    .filter(
      (e) =>
        e.student_id === studentId &&
        e.semester_id === offering.semester_id &&
        !e.unenrolled_at &&
        e.offering_id !== offering.id,
    )
    .map((e) => e.offering_id);

  const out: Array<Record<string, unknown>> = [];
  for (const otherId of otherOfferingIds) {
    const other = getOffering(otherId);
    if (!other) continue;
    const otherLabel = offeringLabel(other);
    for (const m of meetingsForOffering(otherId)) {
      for (const want of mine) {
        if (m.day_of_week !== want.day_of_week) continue;
        if (!overlaps(want.start_time, want.end_time, m.start_time, m.end_time)) continue;
        const slot = slotLabel(m.day_of_week, m.start_time, m.end_time);
        out.push({
          kind: 'student',
          label: student?.full_name ?? 'Student',
          with_offering_id: other.id,
          with_offering_label: otherLabel,
          day_of_week: m.day_of_week,
          start_time: m.start_time,
          end_time: m.end_time,
          message: `${student?.full_name ?? 'This student'} already has ${otherLabel} at ${slot}.`,
        });
      }
    }
  }
  return out;
}

/**
 * The offerings a caller may see, before query filters.
 *
 * Role-scoped like the real backend (FR-CLS-07): a Student sees only what they are enrolled
 * in, a Lecturer only what they teach, the Dean and Registrar everything.
 */
function visibleOfferings(role: string): DemoOffering[] {
  const student = currentDemoStudent(role);
  if (student) {
    const ids = new Set(
      D.enrollments.filter((e) => e.student_id === student.id).map((e) => e.offering_id),
    );
    // An empty set legitimately means "not enrolled in anything" — there is no fallback to
    // "their one section" to reach for any more.
    return D.offerings.filter((o) => ids.has(o.id));
  }
  const teacher = currentDemoTeacher(role);
  if (teacher) {
    const ownedIds = new Set(offeringsOwnedByTeacher(teacher.id).map((o) => o.id));
    return D.offerings.filter((o) => ownedIds.has(o.id));
  }
  if (role === 'hod') {
    // D43 — their programme's offerings UNION their own teaching. The union is not
    // belt-and-braces: a head can teach a shared course that belongs to another
    // programme, and scoping to the programme alone would hide their own gradebook
    // from them.
    //
    // Without this branch an HOD falls through to `return D.offerings` and sees the
    // whole college — the exact shape of the bug the real backend had before its own
    // `elif` was added.
    const visible = new Set([
      ...demoHodOfferingIds(role),
      ...(currentDemoHodTeacher(role)
        ? offeringsOwnedByTeacher(currentDemoHodTeacher(role)!.id).map((o) => o.id)
        : []),
    ]);
    return D.offerings.filter((o) => visible.has(o.id));
  }
  return D.offerings;
}

export const offeringsHandlers = [
  // ── GET /offerings — list (Page[OfferingListItem]) ──────────────────────────────
  http.get(`${API_BASE_URL}/offerings`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = sessionRole(cookies);
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const semesterId = url.searchParams.get('semester_id');
    const courseId = url.searchParams.get('course_id');
    const search = url.searchParams.get('search');

    let rows = visibleOfferings(role);

    // The year filter resolves THROUGH the semester — an offering has no year column.
    if (yearId) {
      const semIds = new Set(
        D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id),
      );
      rows = rows.filter((o) => semIds.has(o.semester_id));
    }
    if (semesterId) rows = rows.filter((o) => o.semester_id === semesterId);
    if (courseId) rows = rows.filter((o) => o.course_id === courseId);
    if (search) {
      const q = search.toLowerCase();
      // Matches the label, the course code and the course name — the three things a person
      // would type. The label is derived, so this searches what they can actually see.
      rows = rows.filter((o) => {
        const course = getCourse(o.course_id);
        return (
          offeringLabel(o).toLowerCase().includes(q) ||
          (course?.code ?? '').toLowerCase().includes(q) ||
          (course?.name ?? '').toLowerCase().includes(q)
        );
      });
    }

    // Ordered by course code then section code, NEVER by the formatted label —
    // "MATH1110-2" would sort before "MATH1110-10". `paginate` is then asked for no sort.
    const ordered = [...rows].sort(compareOfferings);
    const page = paginate(
      ordered.map(offeringListItem) as unknown as Array<Record<string, unknown>>,
      { ...listParamsFrom(url), sort: undefined },
    );
    return HttpResponse.json(page);
  }),

  // ── POST /offerings — schedule a course in a term (Dean/Registrar) ──────────────
  http.post(`${API_BASE_URL}/offerings`, async ({ request }) => {
    const body = (await request.json()) as {
      course_id?: string;
      semester_id?: string | null;
      section_code?: string | null;
      capacity?: number | null;
      teacher_ids?: string[];
      lead_teacher_id?: string | null;
      meetings?: Array<{
        day_of_week: number;
        start_time: string;
        end_time: string;
        room?: string | null;
      }>;
    };
    if (!body.course_id) {
      return errorResponse(422, 'validation_error', 'A course is required.', {
        course_id: ['Required'],
      });
    }
    const course = getCourse(body.course_id);
    if (!course) return errorResponse(404, 'course_not_found', 'Course not found.');

    const semesterId = body.semester_id || getActiveSemester()?.id || DEMO_IDS.activeSemesterId;
    if (!getSemester(semesterId)) {
      return errorResponse(404, 'semester_not_found', 'Session not found.');
    }
    const sectionCode = body.section_code?.trim() || null;

    // Identity is (course, semester, section_code) — and a NULL section counts AS a section,
    // so a second unsectioned offering of the same course in the same term collides too.
    // That mirrors the `COALESCE` in the real unique index; without it the demo would let a
    // duplicate through that the database refuses.
    const clash = D.offerings.find(
      (o) =>
        o.course_id === course.id &&
        o.semester_id === semesterId &&
        (o.section_code ?? '').toLowerCase() === (sectionCode ?? '').toLowerCase(),
    );
    if (clash) {
      return errorResponse(
        409,
        'duplicate_offering',
        'This course is already offered in that session with the same section.',
      );
    }

    const teacherIds = body.teacher_ids ?? [];
    for (const id of teacherIds) {
      if (!getTeacher(id)) return errorResponse(404, 'teacher_not_found', 'Lecturer not found.');
    }
    const lead = body.lead_teacher_id ?? null;
    if (lead && !teacherIds.includes(lead)) {
      return errorResponse(
        422,
        'validation_error',
        'The lead lecturer must be one of the assigned lecturers.',
        { lead_teacher_id: ['Must be one of the assigned lecturers.'] },
      );
    }

    const created: DemoOffering = {
      id: `off-new-${D.offerings.length + 1}`,
      course_id: course.id,
      semester_id: semesterId,
      section_code: sectionCode,
      capacity:
        typeof body.capacity === 'number' && body.capacity > 0 ? Math.floor(body.capacity) : null,
      is_archived: false,
      teacher_ids: teacherIds,
      lead_teacher_id: lead ?? teacherIds[0] ?? null,
      drop_lowest_count: 0,
    };
    D.offerings.push(created);

    // Meetings ride along on the create, so "MATH1110-01, Mr. Smith, Room A, Mon 08:00" is
    // one request rather than three.
    (body.meetings ?? []).forEach((w, i) => {
      D.offering_meetings.push({
        id: `mtg-new-${created.id}-${i + 1}`,
        offering_id: created.id,
        day_of_week: w.day_of_week as 1 | 2 | 3 | 4 | 5,
        start_time: w.start_time.length === 5 ? `${w.start_time}:00` : w.start_time,
        end_time: w.end_time.length === 5 ? `${w.end_time}:00` : w.end_time,
        room: w.room?.trim() || null,
      });
    });

    return HttpResponse.json(offeringDetail(created), { status: 201 });
  }),

  // ── GET /offerings/{id} — detail ────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/offerings/:offeringId`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    return HttpResponse.json(offeringDetail(offering));
  }),

  // ── PATCH /offerings/{id} — section code · capacity · archive ───────────────────
  //
  // The course and the semester are the offering's IDENTITY and are deliberately NOT
  // patchable: changing either would silently move every assessment, grade and enrolment
  // attached to it into a different course or term.
  http.patch(`${API_BASE_URL}/offerings/:offeringId`, async ({ params, request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot change this offering.');
    }
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    if (yearArchived(offering)) {
      return errorResponse(409, 'year_archived', "This offering's year is archived.");
    }

    const body = (await request.json()) as {
      section_code?: string | null;
      capacity?: number | null;
      is_archived?: boolean | null;
    };

    if (body.section_code !== undefined) {
      const next = body.section_code?.trim() || null;
      const clash = D.offerings.find(
        (o) =>
          o.id !== offering.id &&
          o.course_id === offering.course_id &&
          o.semester_id === offering.semester_id &&
          (o.section_code ?? '').toLowerCase() === (next ?? '').toLowerCase(),
      );
      if (clash) {
        return errorResponse(
          409,
          'duplicate_offering',
          'This course is already offered in that session with the same section.',
        );
      }
      offering.section_code = next;
    }
    if (body.capacity !== undefined) {
      offering.capacity =
        typeof body.capacity === 'number' && body.capacity > 0 ? Math.floor(body.capacity) : null;
    }
    if (body.is_archived != null) offering.is_archived = body.is_archived;

    return HttpResponse.json(offeringDetail(offering));
  }),

  // ── DELETE /offerings/{id} — soft delete, only while it has no history ──────────
  http.delete(`${API_BASE_URL}/offerings/:offeringId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'You cannot delete this offering.');
    }
    const idx = D.offerings.findIndex((o) => o.id === String(params.offeringId));
    if (idx === -1) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const offering = D.offerings[idx]!;

    const hasHistory =
      assessmentsForOffering(offering.id).length > 0 ||
      D.attendance_records.some((a) => a.offering_id === offering.id);
    if (hasHistory) {
      return errorResponse(
        409,
        'offering_has_history',
        'This offering has academic history — archive it instead.',
      );
    }

    D.offerings.splice(idx, 1);
    // Close every enrolment it held, mirroring the server's soft delete.
    for (const e of D.enrollments) {
      if (e.offering_id === offering.id && !e.unenrolled_at) {
        e.unenrolled_at = new Date().toISOString();
      }
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // ── GET /offerings/{id}/meetings — the weekly schedule (FR-SCH-01) ──────────────
  http.get(`${API_BASE_URL}/offerings/:offeringId/meetings`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    return HttpResponse.json({
      meetings: meetingsForOffering(offering.id).map(meetingItem),
      conflicts: [],
    });
  }),

  // ── PUT /offerings/{id}/meetings — replace the whole week (FR-SCH-02) ───────────
  //
  // Conflicts WARN, they do not block: the write always succeeds and the clashes ride back
  // in the response, matching the server (and the over-capacity precedent). A demo that
  // rejected a clashing save would teach the opposite of how the real screen behaves.
  http.put(`${API_BASE_URL}/offerings/:offeringId/meetings`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    if (notWritable(offering)) {
      return errorResponse(409, 'year_archived', 'This offering belongs to an archived year.');
    }
    const body = (await request.json()) as {
      meetings?: Array<{
        day_of_week: number;
        start_time: string;
        end_time: string;
        room?: string | null;
      }>;
    };
    const wanted = body.meetings ?? [];

    // Lecturer / room clashes against every OTHER offering IN THE SAME TERM. Same-term is
    // the correct scope now: two offerings in different semesters never coexist in a week,
    // and comparing them (as a year-scoped check would) would invent clashes.
    const myTeacherIds = new Set(offering.teacher_ids);
    const conflicts: Array<Record<string, unknown>> = [];
    for (const other of D.offerings) {
      if (other.id === offering.id) continue;
      if (other.semester_id !== offering.semester_id) continue;
      const otherLabel = offeringLabel(other);
      for (const m of meetingsForOffering(other.id)) {
        for (const want of wanted) {
          if (m.day_of_week !== want.day_of_week) continue;
          if (!overlaps(want.start_time, want.end_time, m.start_time, m.end_time)) continue;
          const slot = slotLabel(m.day_of_week, m.start_time, m.end_time);
          for (const tid of other.teacher_ids) {
            if (!myTeacherIds.has(tid)) continue;
            const name = getTeacher(tid)?.full_name ?? 'This lecturer';
            conflicts.push({
              kind: 'teacher',
              label: name,
              with_offering_id: other.id,
              with_offering_label: otherLabel,
              day_of_week: m.day_of_week,
              start_time: m.start_time,
              end_time: m.end_time,
              message: `${name} also teaches ${otherLabel} at ${slot}.`,
            });
          }
          // Room match is case/whitespace-insensitive, like the server: the office types
          // "Lab 1" and "lab 1" interchangeably.
          const wantRoom = (want.room ?? '').trim().toLowerCase();
          const otherRoom = (m.room ?? '').trim().toLowerCase();
          if (wantRoom && wantRoom === otherRoom) {
            conflicts.push({
              kind: 'room',
              label: m.room ?? '',
              with_offering_id: other.id,
              with_offering_label: otherLabel,
              day_of_week: m.day_of_week,
              start_time: m.start_time,
              end_time: m.end_time,
              message: `${m.room} is already used by ${otherLabel} at ${slot}.`,
            });
          }
        }
      }
    }

    // Replace the set: drop this offering's rows, then append the submitted week.
    for (let i = D.offering_meetings.length - 1; i >= 0; i -= 1) {
      if (D.offering_meetings[i]!.offering_id === offering.id) D.offering_meetings.splice(i, 1);
    }
    wanted.forEach((w, i) => {
      D.offering_meetings.push({
        id: `mtg-new-${offering.id}-${i + 1}`,
        offering_id: offering.id,
        day_of_week: w.day_of_week as 1 | 2 | 3 | 4 | 5,
        // The editor submits "HH:MM"; the API serves "HH:MM:SS".
        start_time: w.start_time.length === 5 ? `${w.start_time}:00` : w.start_time,
        end_time: w.end_time.length === 5 ? `${w.end_time}:00` : w.end_time,
        room: w.room?.trim() || null,
      });
    });

    return HttpResponse.json({
      meetings: meetingsForOffering(offering.id).map(meetingItem),
      conflicts,
    });
  }),

  // ── GET /offerings/{id}/roster — active roster (RosterEntry[], not paginated) ───
  http.get(`${API_BASE_URL}/offerings/:offeringId/roster`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const entries = rosterFor(offering.id)
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((student) => rosterEntry(offering, student));
    return HttpResponse.json(entries);
  }),

  // ── GET /offerings/{id}/enrollable-students — picker for the enrol dialog ───────
  // Offerings-owned convenience read (the Students module owns /students). Returns active
  // students NOT already on this offering's roster, name-sorted.
  http.get(`${API_BASE_URL}/offerings/:offeringId/enrollable-students`, ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const onRoster = new Set(rosterFor(offering.id).map((s) => s.id));
    const url = new URL(request.url);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const rows = D.students
      .filter((s) => s.status === 'Registered' && !onRoster.has(s.id))
      .filter(
        (s) =>
          !search ||
          s.full_name.toLowerCase().includes(search) ||
          s.student_number.toLowerCase().includes(search),
      )
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map(studentRef);
    return HttpResponse.json({ items: rows });
  }),

  // ── POST /offerings/{id}/enrollments — enrol (bulk), warn-only capacity ─────────
  //
  // Enrolling is ADDITIVE. It used to close the student's active enrollment anywhere else in
  // the semester and report it as a `transfer` — correct when a student had one homeroom,
  // and data loss the moment they legitimately take Algebra AND Biology. Both the transfer
  // and the `transferred` field are gone; `schedule_conflicts` replaces them.
  http.post(`${API_BASE_URL}/offerings/:offeringId/enrollments`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    if (notWritable(offering)) {
      return errorResponse(409, 'year_archived', 'This offering belongs to an archived year.');
    }
    const body = (await request.json()) as {
      student_ids?: string[];
      semester_id?: string;
      // D35 — the client's `coursestatus`, applied to the whole batch.
      enrollment_status?: EnrollmentStatus;
    };
    const ids = body.student_ids ?? [];
    // The term is the OFFERING's, not the caller's choice. A `semester_id` that disagrees is
    // refused rather than quietly honoured — writing an enrolment into a term the offering
    // does not run in is how a roster ends up unreachable from every screen.
    if (body.semester_id && body.semester_id !== offering.semester_id) {
      return errorResponse(
        409,
        'semester_mismatch',
        'This offering runs in a different session.',
      );
    }
    const semesterId = offering.semester_id;

    const enrolled: ReturnType<typeof rosterEntry>[] = [];
    // Computed BEFORE the inserts: it asks what the student ALREADY sits that overlaps this
    // offering, and the new rows would otherwise be compared against themselves.
    const schedule_conflicts = ids.flatMap((studentId) =>
      scheduleConflictsForStudent(studentId, offering),
    );

    // D30 §D4 — the prerequisite gate, checked for EVERY student BEFORE anything is
    // written. Mirrors the server exactly, including the all-or-nothing behaviour: a
    // failure part-way through the list would leave the batch half-enrolled.
    for (const studentId of ids) {
      const unmet = unmetPrerequisites(studentId, offering.course_id, semesterId);
      if (unmet.length > 0) {
        const student = getStudent(studentId);
        const detail = unmet.map((u) => `${u.code} (${u.reason})`).join('; ');
        return errorResponse(
          409,
          'prerequisite_not_met',
          `${student?.full_name ?? 'This student'} has not met the prerequisites: ${detail}.`,
        );
      }
    }

    for (const studentId of ids) {
      const student = getStudent(studentId);
      if (!student) return errorResponse(404, 'student_not_found', 'Student not found.');

      const alreadyHere = D.enrollments.find(
        (e) =>
          e.student_id === studentId &&
          e.offering_id === offering.id &&
          e.semester_id === semesterId &&
          !e.unenrolled_at,
      );
      if (!alreadyHere) {
        D.enrollments.push({
          id: `enr-new-${D.enrollments.length + 1}`,
          student_id: studentId,
          offering_id: offering.id,
          semester_id: semesterId,
          enrolled_at: new Date().toISOString(),
          unenrolled_at: null,
          // D35 — the client's `coursestatus`, applied to the whole batch,
          // mirroring `offerings/service.enroll_students`.
          enrollment_status: body.enrollment_status ?? 'enrolled',
        });
      }
      enrolled.push(rosterEntry(offering, student));
    }

    return HttpResponse.json({
      enrolled,
      over_capacity_warning: isOverCapacity(offering, rosterFor(offering.id).length),
      schedule_conflicts,
    });
  }),

  // ── DELETE /offerings/{id}/enrollments/{enrollmentId} — withdraw ────────────────
  http.delete(
    `${API_BASE_URL}/offerings/:offeringId/enrollments/:enrollmentId`,
    ({ params }) => {
      const offering = getOffering(String(params.offeringId));
      if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
      if (notWritable(offering)) {
        return errorResponse(409, 'year_archived', 'This offering belongs to an archived year.');
      }
      const enr = D.enrollments.find((e) => e.id === params.enrollmentId);
      if (!enr) return errorResponse(404, 'not_found', 'Enrollment not found.');
      enr.unenrolled_at = new Date().toISOString();
      // Nothing else to clear: the student's other enrolments are untouched, which is the
      // point — un-enrolling from one course is not leaving the term.
      return new HttpResponse(null, { status: 204 });
    },
  ),

  // ── PATCH /offerings/{id}/enrollments/{enrollmentId} — the course status (D35) ──
  //
  // NOT the DELETE above. That un-enrols and takes the student off the roster; this
  // records that they SAT the course and left, so the row stays open — the transcript has
  // to print `AU` / `W/P` / `W/F` against it, and deleting it would erase that.
  http.patch(
    `${API_BASE_URL}/offerings/:offeringId/enrollments/:enrollmentId`,
    async ({ params, request, cookies }) => {
      const role = sessionRole(cookies);
      if (role !== 'principal' && role !== 'secretary') {
        return errorResponse(403, 'forbidden', 'You cannot change enrolments.');
      }
      const offering = getOffering(String(params.offeringId));
      if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
      if (notWritable(offering)) {
        return errorResponse(409, 'year_archived', 'This offering belongs to an archived year.');
      }
      const enr = D.enrollments.find((e) => e.id === params.enrollmentId);
      if (!enr) return errorResponse(404, 'not_found', 'Enrollment not found.');
      // Mirrors `set_enrollment_status`: there is nothing to describe on a closed row.
      if (enr.unenrolled_at) {
        return errorResponse(
          409,
          'enrollment_closed',
          'This student is no longer enrolled in the offering, so their course status cannot be set. Re-enrol them first.',
        );
      }
      const body = (await request.json()) as { enrollment_status?: EnrollmentStatus };
      const next = body.enrollment_status;
      const allowed: EnrollmentStatus[] = [
        'enrolled',
        'audit',
        'withdraw_passing',
        'withdraw_failing',
      ];
      if (!next || !allowed.includes(next)) {
        return errorResponse(422, 'validation_error', 'Unknown course status.', {
          enrollment_status: ['Must be enrolled, audit, withdraw_passing or withdraw_failing.'],
        });
      }
      enr.enrollment_status = next;
      const student = D.students.find((s) => s.id === enr.student_id);
      if (!student) return errorResponse(404, 'not_found', 'Student not found.');
      return HttpResponse.json(rosterEntry(offering, student));
    },
  ),

  // ── PUT /offerings/{id}/teachers — set the lecturer(s) ─────────────────────────
  //
  // One id, no homeroom hop. The predecessor was
  // `PUT /classes/{id}/subjects/{csId}/teachers`, threading two ids to reach one gradebook's
  // lecturers, because owning one subject of a section was a different question from owning
  // the section. One course per offering makes those the same question.
  http.put(`${API_BASE_URL}/offerings/:offeringId/teachers`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    if (notWritable(offering)) {
      return errorResponse(409, 'year_archived', 'This offering belongs to an archived year.');
    }
    const body = (await request.json()) as {
      teacher_ids?: string[];
      lead_teacher_id?: string | null;
    };
    const teacherIds = body.teacher_ids ?? [];
    for (const id of teacherIds) {
      if (!getTeacher(id)) return errorResponse(404, 'teacher_not_found', 'Lecturer not found.');
    }
    const lead = body.lead_teacher_id ?? null;
    if (lead && !teacherIds.includes(lead)) {
      return errorResponse(
        422,
        'validation_error',
        'The lead lecturer must be one of the assigned lecturers.',
        { lead_teacher_id: ['Must be one of the assigned lecturers.'] },
      );
    }
    offering.teacher_ids = teacherIds;
    offering.lead_teacher_id = lead ?? teacherIds[0] ?? null;
    return HttpResponse.json(offeringDetail(offering));
  }),

  // ── GET|POST /offerings/{id}/categories — assessment weighting groups ──────────
  //
  // Re-pathed from `/classes/{class_id}/subjects/{cs_id}/categories`, which threaded a
  // homeroom id AND a class_subject id to reach ONE gradebook's categories.
  http.get(`${API_BASE_URL}/offerings/:offeringId/categories`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const items = D.assessment_categories.filter((c) => c.offering_id === offering.id);
    return HttpResponse.json({ items });
  }),

  http.post(`${API_BASE_URL}/offerings/:offeringId/categories`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const body = (await request.json()) as {
      name?: string;
      weight?: number;
      drop_lowest_count?: number;
    };
    if (!body.name?.trim()) {
      return errorResponse(422, 'validation_error', 'A category name is required.', {
        name: ['Required'],
      });
    }
    const created = {
      id: `cat-new-${D.assessment_categories.length + 1}`,
      offering_id: offering.id,
      name: body.name.trim(),
      weight: body.weight ?? 1,
      drop_lowest_count: body.drop_lowest_count ?? 0,
    };
    D.assessment_categories.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(
    `${API_BASE_URL}/offerings/:offeringId/categories/:categoryId`,
    async ({ params, request }) => {
      const offering = getOffering(String(params.offeringId));
      if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
      const category = D.assessment_categories.find(
        (c) => c.id === String(params.categoryId) && c.offering_id === offering.id,
      );
      if (!category) return errorResponse(404, 'not_found', 'Category not found.');
      const body = (await request.json()) as {
        name?: string;
        weight?: number;
        drop_lowest_count?: number;
      };
      if (body.name !== undefined && body.name.trim()) category.name = body.name.trim();
      if (body.weight !== undefined) category.weight = body.weight;
      if (body.drop_lowest_count !== undefined) {
        category.drop_lowest_count = body.drop_lowest_count;
      }
      return HttpResponse.json(category);
    },
  ),

  http.delete(`${API_BASE_URL}/offerings/:offeringId/categories/:categoryId`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const idx = D.assessment_categories.findIndex(
      (c) => c.id === String(params.categoryId) && c.offering_id === offering.id,
    );
    if (idx === -1) return errorResponse(404, 'not_found', 'Category not found.');
    const category = D.assessment_categories[idx]!;
    if (D.assessments.some((a) => a.category_id === category.id)) {
      return errorResponse(
        409,
        'category_in_use',
        'Assessments are grouped under this category. Move them first.',
      );
    }
    D.assessment_categories.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
