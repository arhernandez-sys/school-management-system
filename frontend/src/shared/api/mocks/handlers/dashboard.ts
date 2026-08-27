import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  DEMO_TODAY,
  announcementsForUser,
  assessmentsForOffering,
  attendanceFor,
  attendanceRateForStudent,
  computeTermGrade,
  currentOfferingsFor,
  getActiveSemester,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  getTeacher,
  gpaFor,
  gradeDistribution,
  letterFor,
  offeringLabel,
  offeringsForStudent,
  offeringsOwnedByTeacher,
  rosterFor,
  schoolAttendanceRate,
  unreadCountForUser,
} from '@shared/api/mocks/demo/dataset';
import type { DemoAnnouncement, DemoOffering, DemoUser } from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for the DASHBOARD module (api-spec §5 Module 2) — DEMO.
 *
 * ONE composite endpoint: GET /dashboard. The response is a role-DISCRIMINATED payload
 * (principal/secretary share the school-wide shape; teacher and student each get their
 * own). Role + scope are derived SERVER-SIDE from the mock session cookie, exactly like
 * handlers/settings.ts resolves "self" for /settings/account — the demo login only
 * carries a role, and resolveMockUser() returns a synthetic user whose profile ids are
 * NOT seeded dataset ids, so we map role → a representative SEEDED user here and derive
 * teacher/student scope from that. This keeps every figure reconciled with the list and
 * detail screens (dashboard.active_students === listStudents({status:'active'}).total).
 *
 * All figures come from the shared selectors; time is anchored to DEMO_TODAY (no
 * Date.now/Math.random), so the payload is byte-stable across reloads.
 *
 * ⚠️ Do NOT touch handlers/index.ts — `dashboardHandlers` is already wired in.
 */
const D = DEMO_DATASET;

/** Representative seeded user id per role (the demo cookie only carries a role). */
const REPRESENTATIVE_USER_ID: Record<string, string> = {
  principal: DEMO_IDS.principalUserId,
  secretary: 'user-secretary',
  teacher: 'user-teach-1', // Maria Reyes — leads several Algebra offerings
  student: 'user-stu-1', // Freddy Lopez — active, first-year, MATH1110-01
};

function resolveUser(role: string): DemoUser {
  const id = REPRESENTATIVE_USER_ID[role];
  return D.users.find((u) => u.id === id) ?? D.users.find((u) => u.role === role) ?? D.users[0]!;
}

function announcementView(a: DemoAnnouncement, userId: string) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience,
    published_at: a.published_at,
    is_read: a.read_by_user_ids.includes(userId),
  };
}

/**
 * The shared `OfferingRef`.
 *
 * Every dashboard row that used to carry `subject_name` + `section_name` — two strings the
 * server assembled for these cards alone — carries this instead. The label is derived once
 * (`offeringLabel`), so a card and the offerings list cannot name the same thing differently.
 */
function offeringRef(offering: DemoOffering) {
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  return {
    id: offering.id,
    course: course
      ? { id: course.id, name: course.name, code: course.code, credits: course.credits }
      : { id: offering.course_id, name: 'Unknown course', code: null, credits: null },
    semester: semester
      ? {
          id: semester.id,
          name: semester.name,
          sequence: semester.sequence,
          is_active: semester.is_active,
        }
      : null,
    section_code: offering.section_code,
    label: offeringLabel(offering),
  };
}

function termHeader() {
  const year = getActiveYear();
  const semester = getActiveSemester();
  return {
    academic_year_name: year?.name ?? null,
    semester_name: semester?.name ?? null,
  };
}

// ── Admin (principal) — school-wide ─────────────────────────────────────────────
function adminPayload(user: DemoUser) {
  const activeStudents = D.students.filter((s) => s.status === 'Registered');
  const liveOfferings = D.offerings.filter((o) => !o.is_archived);
  const active_students = activeStudents.length;

  // Seats denominator for the "students" progress bar: the sum of offering capacities. A
  // NULL capacity means "no limit" and contributes nothing, so the bar describes only the
  // offerings that actually declare one.
  const student_capacity = liveOfferings.reduce((sum, o) => sum + (o.capacity ?? 0), 0);

  // New intake = the entry-year cohort, read from the student's own `year_of_study` rather
  // than from a homeroom's grade level. Reconciles with the First-year figure elsewhere.
  const new_students_term = activeStudents.filter((s) => s.year_of_study === 'First').length;

  // Live course offerings.
  const total_courses = liveOfferings.length;

  // Enrollment trend (demo series): six terms of believable growth, anchored so the
  // final point equals the LIVE active_students count and reconciles with the KPI card.
  const trendPeriods = ['S2 2022–23', 'S1 2023–24', 'S2 2023–24', 'S1 2024–25', 'S2 2024–25', 'S1 2025–26'];
  const trendOffsets = [15, 13, 10, 7, 4, 0];
  const enrollment_trend = trendPeriods.map((period, i) => ({
    period,
    count: Math.max(0, active_students - trendOffsets[i]!),
  }));

  // Self-contained people lists for the Teachers / Students cards (no list-endpoint coupling).
  const recent_teachers = D.teachers
    .filter((t) => t.status === 'active')
    .slice(0, 6)
    .map((t) => ({
      id: t.id,
      name: t.full_name,
      secondary: t.subject_specializations.join(' · ') || 'General',
      status: { label: 'Active', kind: 'success' as const },
    }));

  const recent_students = activeStudents
    .filter((s) => currentOfferingsFor(s.id).length > 0)
    .slice(0, 6)
    .map((s) => ({
      id: s.id,
      name: s.full_name,
      // A student has no single class to name here, so the row shows their level.
      secondary: s.year_of_study ?? '—',
      status: { label: 'Active', kind: 'success' as const },
    }));

  return {
    role: user.role,
    user_full_name: user.full_name,
    ...termHeader(),
    stats: {
      active_students,
      active_teachers: D.teachers.filter((t) => t.status === 'active').length,
      total_sections: liveOfferings.length,
      attendance_rate: schoolAttendanceRate(),
      unread_announcements: unreadCountForUser(user.id),
      new_students_term,
      total_courses,
      student_capacity,
    },
    /**
     * Bucketed by PROGRAMME (D31), not by Form. `classes.grade_level` was a homeroom column
     * and a K-12 axis a junior college does not have; the SAME breakdown backs the
     * enrolment report, so the tile and the report cannot disagree.
     *
     * Counted per STUDENT, not per offering: by offering, one student would be counted once
     * per course they take.
     */
    enrollment_by_programme: (() => {
      const byId = new Map<string, number>();
      for (const s of activeStudents) {
        if (!s.program_id) continue;
        byId.set(s.program_id, (byId.get(s.program_id) ?? 0) + 1);
      }
      return [...byId.entries()]
        .map(([programme_id, count]) => {
          const programme = D.programs.find((pr) => pr.id === programme_id);
          return {
            programme_id,
            programme_code: programme?.code ?? '?',
            programme_name: programme?.name ?? 'Unknown programme',
            count,
          };
        })
        .sort((a, b) => b.count - a.count || a.programme_code.localeCompare(b.programme_code));
    })(),
    grade_distribution: gradeDistribution(),
    enrollment_trend,
    recent_teachers,
    recent_students,
    recent_announcements: announcementsForUser(user.id)
      .slice(0, 5)
      .map((a) => announcementView(a, user.id)),
  };
}

// ── Secretary — records clerk: quick actions + setup tasks (FR-DASH-03) ──────────
function secretaryPayload(user: DemoUser) {
  const offerings = D.offerings.filter((o) => !o.is_archived);
  const unstaffed_subjects = offerings.filter((o) => o.teacher_ids.length === 0).length;
  // A NULL capacity can never be over — "no limit" is not "limit zero".
  const over_capacity_sections = offerings.filter(
    (o) => o.capacity != null && o.capacity > 0 && rosterFor(o.id).length > o.capacity,
  ).length;

  // Most-recent active enrollments (newest first). Ties break on id so it's stable.
  const recent_enrollments = D.enrollments
    .filter((e) => !e.unenrolled_at)
    .slice()
    .sort(
      (a, b) => b.enrolled_at.localeCompare(a.enrolled_at) || b.id.localeCompare(a.id),
    )
    .slice(0, 6)
    .map((e) => ({
      enrollment_id: e.id,
      student_name: getStudent(e.student_id)?.full_name ?? 'Unknown student',
      offering_label: offeringLabel(getOffering(e.offering_id)) || 'Unknown offering',
      enrolled_at: e.enrolled_at,
    }));

  return {
    role: 'secretary' as const,
    user_full_name: user.full_name,
    ...termHeader(),
    stats: {
      active_students: D.students.filter((s) => s.status === 'Registered').length,
      active_teachers: D.teachers.filter((t) => t.status === 'active').length,
      total_sections: offerings.length,
      unstaffed_subjects,
      over_capacity_sections,
      unread_announcements: unreadCountForUser(user.id),
    },
    recent_enrollments,
    recent_announcements: announcementsForUser(user.id)
      .slice(0, 5)
      .map((a) => announcementView(a, user.id)),
  };
}

// ── Teacher — own classes, attendance-forward ───────────────────────────────────
function teacherPayload(user: DemoUser) {
  const teacher = getTeacher(
    D.teachers.find((t) => t.user_id === user.id)?.id ?? '',
  );
  const owned = teacher ? offeringsOwnedByTeacher(teacher.id).filter((o) => !o.is_archived) : [];

  /**
   * Today's offerings, with whether attendance is recorded for DEMO_TODAY.
   *
   * One row per OFFERING, and no de-duplication needed. The predecessor iterated SECTIONS
   * and then picked one of their class_subjects, with a comment explaining that a teacher
   * may teach several subjects in the same homeroom "but attendance is per-section-per-day"
   * — a de-duplication that silently DROPPED offerings. Attendance is per offering now, so
   * every row the lecturer owes is listed.
   */
  const today_classes = owned.map((offering) => ({
    offering: offeringRef(offering),
    attendance_recorded: attendanceFor(offering.id, DEMO_TODAY).length > 0,
  }));

  // Recent/upcoming assessments across owned offerings that still need action.
  const recent_assessments = owned
    .flatMap((offering) =>
      assessmentsForOffering(offering.id)
        .filter((a) => a.status === 'published' || a.status === 'grading')
        .map((a) => ({
          id: a.id,
          title: a.title,
          offering: offeringRef(offering),
          assessment_date: a.assessment_date,
          status: a.status,
        })),
    )
    .sort((x, y) => (x.assessment_date ?? '').localeCompare(y.assessment_date ?? ''))
    .slice(0, 6);

  const ungraded_items = owned.reduce(
    (n, offering) =>
      n +
      assessmentsForOffering(offering.id).filter(
        (a) => a.status === 'published' || a.status === 'grading',
      ).length,
    0,
  );

  // Assessments MARKED but still HIDDEN from students. Deliberately NOT the same
  // figure as `ungraded_items` (work still to do) — an assessment can be in both,
  // which is correct: it has two outstanding actions. Same predicate as the
  // backend's graded_unreleased_clause().
  const awaiting_release = owned
    .flatMap((offering) =>
      assessmentsForOffering(offering.id)
        .map((a) => {
          const graded_unreleased_count = D.assessment_grades.filter(
            (g) =>
              g.assessment_id === a.id &&
              g.status === 'graded' &&
              (g.is_released === false || (g.is_released == null && !a.is_released)),
          ).length;
          return {
            id: a.id,
            title: a.title,
            offering: offeringRef(offering),
            assessment_date: a.assessment_date,
            status: a.status,
            // The flat id as well as the ref: the row LINKS to the gradebook, which is
            // addressed by offering id, and a link target should not have to reach into a
            // nested object.
            offering_id: offering.id,
            graded_unreleased_count,
          };
        })
        .filter((row) => row.graded_unreleased_count > 0),
    )
    .sort((x, y) => (x.assessment_date ?? '').localeCompare(y.assessment_date ?? ''));

  return {
    role: 'teacher' as const,
    user_full_name: user.full_name,
    ...termHeader(),
    stats: {
      // ONE count. It used to report `my_sections` (distinct homerooms) AND
      // `my_class_subjects` (offerings), which were the same number the moment a class
      // taught one subject — the card showed the same figure twice under two names.
      my_offerings: owned.length,
      attendance_due_today: today_classes.filter((c) => !c.attendance_recorded).length,
      ungraded_items,
      awaiting_release_items: awaiting_release.length,
    },
    today_classes,
    recent_assessments,
    awaiting_release,
    recent_announcements: announcementsForUser(user.id)
      .slice(0, 4)
      .map((a) => announcementView(a, user.id)),
  };
}

// ── Student — own data (released grades only) ───────────────────────────────────
function studentPayload(user: DemoUser) {
  const student = D.students.find((s) => s.user_id === user.id);
  // Every offering the student takes this term.
  const offerings = student
    ? offeringsForStudent(student.id).filter((o) => !o.is_archived)
    : [];

  const my_classes = offerings.map((offering) => {
    const lead = offering.lead_teacher_id ? getTeacher(offering.lead_teacher_id) : undefined;
    return {
      offering: offeringRef(offering),
      teacher_name: lead?.full_name ?? 'Unassigned',
    };
  });

  // Term average across the student's class_subjects (weighted per-subject, then
  // simple-averaged for a single headline figure); letter derived from the same scale.
  const perSubject = student
    ? offerings
        .map((offering) => computeTermGrade(student.id, offering.id).numeric)
        .filter((n): n is number => n != null)
    : [];
  const term_average =
    perSubject.length > 0
      ? Math.round((perSubject.reduce((a, b) => a + b, 0) / perSubject.length) * 10) / 10
      : null;
  const term_letter = term_average != null ? letterFor(term_average) : null;

  // Credit-weighted term GPA (D30 §D5), from the same selectors the report card uses so
  // the dashboard tile and the printed document cannot disagree. Every offering the
  // student sits contributes its credits; one with no released grade contributes 0
  // quality points (decision #4).
  const termGpa = student
    ? gpaFor(
        offerings.map((offering) => ({
          credits: getCourse(offering.course_id)?.credits ?? null,
          letter: computeTermGrade(student.id, offering.id).letter,
        })),
      )
    : { gpa: null, total_credits: 0 };

  // Recent RELEASED grades only (unreleased is never sent — architecture §3.2/§8.5).
  const recent_grades = student
    ? offerings
        .flatMap((offering) =>
          assessmentsForOffering(offering.id)
            .filter((a) => a.status === 'graded' && a.is_released)
            .map((a) => {
              const g = D.assessment_grades.find(
                (row) => row.assessment_id === a.id && row.student_id === student.id,
              );
              const released = g?.is_released ?? a.is_released;
              if (!g || g.status !== 'graded' || g.score == null || !released) return null;
              return {
                assessment_id: a.id,
                title: a.title,
                offering: offeringRef(offering),
                score: g.score,
                max_score: a.max_score,
                letter: letterFor((g.score / a.max_score) * 100),
                _date: a.assessment_date ?? '',
              };
            }),
        )
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((x, y) => y._date.localeCompare(x._date))
        .slice(0, 6)
        .map(({ _date, ...rest }) => rest)
    : [];

  // Upcoming assessments (dated after DEMO_TODAY), soonest first.
  const upcoming_assessments = offerings
    .flatMap((offering) =>
      assessmentsForOffering(offering.id)
        .filter((a) => a.assessment_date != null && a.assessment_date > DEMO_TODAY)
        .map((a) => ({
          id: a.id,
          title: a.title,
          offering: offeringRef(offering),
          assessment_date: a.assessment_date,
        })),
    )
    .sort((x, y) => (x.assessment_date ?? '').localeCompare(y.assessment_date ?? ''))
    .slice(0, 5);

  // The student's OWN rate across every offering they sit — attendance is per offering, so
  // one course's register is not "my attendance".
  const attendance_rate = student ? attendanceRateForStudent(student.id) : 0;

  return {
    role: 'student' as const,
    user_full_name: user.full_name,
    ...termHeader(),
    stats: {
      term_average,
      term_letter,
      gpa: termGpa.gpa,
      total_credits: termGpa.total_credits,
      attendance_rate,
      upcoming_count: upcoming_assessments.length,
    },
    my_classes,
    recent_grades,
    upcoming_assessments,
    announcements: announcementsForUser(user.id)
      .slice(0, 5)
      .map((a) => announcementView(a, user.id)),
  };
}

export const dashboardHandlers = [
  http.get(`${API_BASE_URL}/dashboard`, ({ cookies }) => {
    const role = cookies['sis_mock_session'] ?? 'principal';
    const user = resolveUser(role);
    const semester = getActiveSemester();
    if (!semester) {
      return errorResponse(409, 'no_active_semester', 'No active academic session is configured.');
    }
    if (user.role === 'teacher') return HttpResponse.json(teacherPayload(user));
    if (user.role === 'student') return HttpResponse.json(studentPayload(user));
    if (user.role === 'secretary') return HttpResponse.json(secretaryPayload(user));
    return HttpResponse.json(adminPayload(user));
  }),
];
