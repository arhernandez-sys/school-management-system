/**
 * DEMO DATASET — the single in-memory fake dataset (frontend-only client demo).
 *
 * A realistic Belize **junior college** (BAJC). EVERYTHING reconciles: dashboards, lists,
 * gradebooks, report cards and transcripts are all derived from THIS object by the
 * selectors in `selectors.ts`, so counts and grades agree across screens.
 *
 * DETERMINISM (hard requirement): no `Date.now()` / `Math.random()` at module load.
 * A fixed `DEMO_TODAY` anchors all "recent" data and a small seeded PRNG (`rng`)
 * generates believable-but-stable scores/attendance. Re-loading the module always
 * yields byte-identical data, so screenshots and tests are reproducible.
 *
 * ⚠️ Module agents: treat this file as read-only reference data. Read via the
 * selectors; do not mutate it (handlers may mutate a working copy — see selectors).
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * D31 — WHY THIS DATASET IS SHAPED THE WAY IT IS
 * ────────────────────────────────────────────────────────────────────────────────
 * It began as 8 homerooms ("Form 1A") each teaching 7 subjects, with every student in
 * exactly one. D29 broke that into per-subject classes. **D31 finished the job**: the unit
 * is a COURSE OFFERING — one catalog course, one SEMESTER, an optional section code — and
 * `sections` + `class_subjects` collapsed into one `offerings` table.
 *
 * The dataset hard-codes the two scenarios that PROVE the model rather than generating them:
 *
 *   1. **Parallel sections.** Two students share courses but sit different sections:
 *
 *          Freddy Lopez (stu-1)  →  MATH1110-01 · BIOL1102-01 · ENGL1102-01 · CHEM1100-01
 *          John Garcia  (stu-2)  →  MATH1110-02 · BIOL1102-01 · ENGL1102-01 · ITEC1104-01
 *
 *      Same Biology and English, DIFFERENT Algebra section, so their timetables differ in
 *      exactly one slot. A homeroom model cannot express that at all.
 *
 *   2. **The same course in two terms.** `MATH1110-01` and `BIOL1102-01` each run again in
 *      Semester 2 as separate offerings with their own rosters and assessments. THIS is the
 *      capability the year-scoped `classes` model could not express, and the reason D31
 *      exists — a year-scoped row can only say "Algebra, sometime in 2025-2026".
 *
 * `stu-1` is the seeded `student` login (DEMO_REPRESENTATIVE_USER_ID), so signing in as the
 * demo student lands on Freddy.
 *
 * An offering has NO `name`. Its label ("MATH1110-01") is derived from course code + section
 * code by `offeringLabel` in the selectors — the one place, mirroring the server's
 * `offerings/labels.py`. The seeds below use a `key` (also "MATH1110-01") purely as a
 * build-time handle for wiring loads together; it is never stored on a row.
 */
import type {
  DemoAcademicYear,
  DemoApplication,
  DemoApplicationTemp,
  DemoApplicationDocument,
  DemoApplicationEducation,
  DemoAnnouncement,
  DemoAssessment,
  DemoAssessmentCategory,
  DemoAssessmentGrade,
  DemoAssessmentPolicy,
  DemoAttendanceRecord,
  DemoCourse,
  DemoCoursePrerequisite,
  DemoCreditTransferRequest,
  DemoDataset,
  DemoEnrollment,
  DemoEvent,
  DemoGradeRevisionRequest,
  DemoGradingScale,
  DemoOffering,
  DemoOfferingMeeting,
  DemoProgram,
  DemoProgramCourse,
  DemoSchoolProfile,
  DemoSemester,
  DemoReligion,
  DemoStudent,
  DemoStudentProgramHistory,
  DemoTeacher,
  DemoUser,
} from './types';
import type {
  AttendanceStatus,
  District,
  EnrollmentLoad,
  GradeStatus,
} from '@shared/types/enums';
import {
  BAJC_ALL_COURSE_GATES,
  BAJC_COURSES,
  BAJC_CURRICULUM,
  BAJC_PREREQUISITES,
  BAJC_PROGRAMS,
} from './bajcCatalog';

/**
 * The demo "now". All relative/recent data (attendance window, announcement dates,
 * last-login) is anchored to this fixed instant so the dataset is deterministic.
 * Falls inside the active Semester 1 of 2025-2026.
 */
export const DEMO_TODAY = '2025-10-15';
export const DEMO_TODAY_ISO = '2025-10-15T09:00:00Z';

// ── Tiny deterministic PRNG (mulberry32) ────────────────────────────────────────
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ── Date helpers (deterministic, UTC) ───────────────────────────────────────────
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isWeekday(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

// ── School profile ──────────────────────────────────────────────────────────────
const school_profile: DemoSchoolProfile = {
  name: 'Belize Adventist Junior College',
  address: 'Corozal Town, Corozal District, Belize',
  phone: '+501-422-2015',
  email: 'office@bajc.edu.bz',
  logo_url: '/logo.jpeg',
  // Brand colors sampled from the BAJC seal (navy triangle + crimson ring).
  colors: { primary: '#1E3A6E', secondary: '#C21F30' },
};

// ── Academic years + semesters ──────────────────────────────────────────────────
const YEAR_ARCHIVED = 'ay-2024';
const YEAR_ACTIVE = 'ay-2025';
const SEM_ACTIVE = 'sem-2025-1'; // Semester 1 of active year = active term
const SEM_2025_2 = 'sem-2025-2'; // Semester 2 of the active year (upcoming)

const academic_years: DemoAcademicYear[] = [
  {
    id: YEAR_ARCHIVED,
    name: '2024-2025',
    start_date: '2024-09-02',
    end_date: '2025-06-27',
    status: 'archived',
    archived_at: '2025-07-15T12:00:00Z',
  },
  {
    id: YEAR_ACTIVE,
    name: '2025-2026',
    start_date: '2025-09-01',
    end_date: '2026-06-26',
    status: 'active',
    archived_at: null,
  },
];

const semesters: DemoSemester[] = [
  {
    id: 'sem-2024-1',
    academic_year_id: YEAR_ARCHIVED,
    name: 'Semester 1',
    term_type: 'semester',
    sequence: 1,
    start_date: '2024-09-02',
    end_date: '2025-01-17',
    grade_submission_deadline: null,
    midterm_submission_start: null,
    midterm_submission_end: null,
    is_active: false,
  },
  {
    id: 'sem-2024-2',
    academic_year_id: YEAR_ARCHIVED,
    name: 'Semester 2',
    term_type: 'semester',
    sequence: 2,
    start_date: '2025-01-20',
    end_date: '2025-06-27',
    grade_submission_deadline: null,
    midterm_submission_start: null,
    midterm_submission_end: null,
    is_active: false,
  },
  {
    id: SEM_ACTIVE,
    academic_year_id: YEAR_ACTIVE,
    name: 'Semester 1',
    term_type: 'semester',
    sequence: 1,
    start_date: '2025-09-01',
    end_date: '2026-01-16',
    // D30 §D6 — a deadline in the FUTURE relative to DEMO_TODAY (2025-10-15). Deliberate:
    // it makes the feature visible (Settings shows "Grades due", the term editor shows the
    // field) WITHOUT locking the marquee gradebook, which a past deadline would turn
    // read-only for the whole demo. To see the closed state, move this date behind
    // DEMO_TODAY from Settings → Academic structure and reopen the gradebook — the banner
    // appears and the save bar disables, exactly as the backend behaves.
    grade_submission_deadline: '2026-01-23T23:59:00Z',
    // D32 - a mid-term window that has already CLOSED relative to DEMO_TODAY
    // (2025-10-15). The opposite choice from the end-term deadline above, and for the
    // same reason: this is what makes the feature visible. A window still open would
    // hide the Revision column entirely and the demo would show nothing.
    //
    // With these dates, assessments dated before 2025-09-20 are revisable and anything
    // after 2025-10-10 is not - so the marquee gradebook shows BOTH states side by side,
    // which is the whole point of the rule.
    midterm_submission_start: '2025-09-20T00:00:00Z',
    midterm_submission_end: '2025-10-10T23:59:00Z',
    is_active: true,
  },
  {
    id: 'sem-2025-2',
    academic_year_id: YEAR_ACTIVE,
    name: 'Semester 2',
    term_type: 'semester',
    sequence: 2,
    start_date: '2026-01-19',
    end_date: '2026-06-26',
    grade_submission_deadline: '2026-07-03T23:59:00Z',
    midterm_submission_start: null,
    midterm_submission_end: null,
    is_active: false,
  },
];

// ── The BAJC course catalog (D30 Phase 2D) ──────────────────────────────────────
//
// All 114 courses from the 2026/27 sequences, generated into `bajcCatalog.ts` from the
// same parsed PDF as the backend's `app/db/bajc_catalog.py`. This replaces the eleven
// invented high-school subjects (Mathematics, English, Geography, …) that stood in
// until now, and closes plan §G item 6.
//
// Generating both sides from one source is the point: demo mode and the real backend
// cannot disagree about what the college offers, and this project has already paid
// twice for a demo that certified something the server answered differently.
const courses: DemoCourse[] = BAJC_COURSES.map(([code, name, credits, component]) => ({
  id: `course-${code.toLowerCase()}`,
  name,
  code,
  credits,
  component,
  is_active: true,
}));
const courseId = (code: string): string => `course-${code.toLowerCase()}`;
/** Display name for a catalog code — throws loudly if a seed names a course that
 *  is not in the 26/27 sequences, which is a data error, not a soft failure. */
const courseName = (code: string): string => {
  const found = BAJC_COURSES.find(([c]) => c === code);
  if (!found) throw new Error(`demo dataset: no BAJC course with code ${code}`);
  return found[1];
};

// ── Course offerings (D31) ──────────────────────────────────────────────────────
//
// Each row is one offering: a catalog course, a TERM, an optional section code, the lecturer
// who leads it, a room, a capacity, and the weekly slots it meets in.
//
// Two things in this seed are load-bearing, and each one is a capability the previous model
// could not express:
//
//   * **`MATH1110` has THREE parallel sections in Semester 1** (01 / 02 / 03), which is what
//     lets Freddy and John share every other course and still hold different timetables.
//   * **`MATH1110-01` and `BIOL1102-01` run AGAIN in Semester 2** as separate offerings.
//     Under the year-scoped `classes` model those were unrepresentable: one row could only
//     say "Algebra, sometime in 2025-2026", and the two terms' assessments piled into the
//     same gradebook.
//
// Meetings are written as [ISO weekday, start, end]. `room` is applied to every meeting of
// the offering here for brevity, but it is stored PER MEETING — `course_offerings` has no
// room column, because a course can legitimately meet in a lecture room and a lab.
interface OfferingSeed {
  /**
   * Build-time handle, spelled like the label the selectors will derive. NOT stored: it
   * only wires student loads and the historical mirror to the right row.
   */
  key: string;
  /** Catalog code — must exist in BAJC_COURSES. */
  code: string;
  /** "01"/"02" for parallel sections; null when the course has only one. */
  sectionCode: string | null;
  /** Defaults to the active term. */
  semesterId?: string;
  /**
   * Lecturer NAMES; the first is the lead. Omit to take the course's usual lecturer (the
   * first active specialist). Named rather than resolved by course code so a parallel
   * section can genuinely be staffed by somebody else — resolving by code returns the same
   * specialist the sibling section already has.
   */
  teacherNames?: string[];
  room: string;
  /** `null` = no capacity limit, which is a real and previously untested state. */
  capacity: number | null;
  meetings: ReadonlyArray<[1 | 2 | 3 | 4 | 5, string, string]>;
}

// MATH1210 (Pre-Calculus) is here on purpose: it genuinely requires MATH1110 (Intermediate
// Algebra) in the 26/27 sequences, so the prerequisite gate fires in demo mode on a real
// rule rather than an invented one.
const offeringSeed: readonly OfferingSeed[] = [
  // ── Semester 1 of the active year ──
  { key: 'MATH1110-01', code: 'MATH1110', sectionCode: '01', room: 'Room A', capacity: 20,
    meetings: [[1, '08:00', '09:30'], [3, '08:00', '09:30']] },
  // -02 is -01's parallel section: same course, same term, different lecturer/room/time.
  // The lecturer is NAMED, not derived: `teacherByCode` returns the first active specialist,
  // and for either MATH code that is Maria Reyes — who already leads -01. Deriving it
  // produced a "parallel section" taught by the same person an hour later, which is exactly
  // the claim this row exists to make true.
  { key: 'MATH1110-02', code: 'MATH1110', sectionCode: '02', teacherNames: ['Marlon Pou'], room: 'Room C', capacity: 20,
    meetings: [[1, '10:00', '11:30'], [3, '10:00', '11:30']] },
  // Capacity 26, not 24: every first-year load includes Biology, and the archived year's
  // fallback load adds the graduated/withdrawn students on top, so 24 seated 25. Enrolling
  // over capacity is warn-only (D-Q6) rather than refused, so the old number did not fail —
  // it quietly seeded a college that breaks its own rule on the screen showing the warning.
  { key: 'BIOL1102-01', code: 'BIOL1102', sectionCode: '01', room: 'Lab 1', capacity: 26,
    meetings: [[2, '09:00', '10:30'], [4, '09:00', '10:30']] },
  // Wednesday sits at 13:00, NOT 11:00: MATH1110-02 runs Wed 10:00–11:30, and every student
  // on that load also takes English, so an 11:00 English would put 15 of them in two rooms
  // at once. The seeded week must be one a real student could actually walk.
  //
  // Capacity 32 for the same reason as Biology, only larger: EVERY one of the 30 first-years
  // takes English, so any capacity below the intake is over-subscribed by construction.
  { key: 'ENGL1102-01', code: 'ENGL1102', sectionCode: '01', room: 'Room D', capacity: 32,
    meetings: [[3, '13:00', '14:00'], [5, '11:00', '12:00']] },
  { key: 'CHEM1100-01', code: 'CHEM1100', sectionCode: '01', room: 'Lab 2', capacity: 18,
    meetings: [[2, '11:00', '12:30']] },
  { key: 'ITEC1104-01', code: 'ITEC1104', sectionCode: '01', room: 'Computer Lab', capacity: 22,
    meetings: [[5, '08:00', '09:30']] },
  // A third section of the same course, for the second-year cohort.
  { key: 'MATH1110-03', code: 'MATH1110', sectionCode: '03', room: 'Room A', capacity: 18,
    meetings: [[2, '08:00', '09:30'], [4, '11:00', '12:30']] },
  // Gated on Algebra: enrolling a student who has not passed MATH1110 is a 409 naming it.
  { key: 'MATH1210-01', code: 'MATH1210', sectionCode: '01', room: 'Room F', capacity: 16,
    meetings: [[1, '13:00', '14:30']] },
  { key: 'MGMT1106-01', code: 'MGMT1106', sectionCode: '01', room: 'Room B', capacity: 20,
    meetings: [[4, '13:00', '14:30']] },
  { key: 'SPAN2112-01', code: 'SPAN2112', sectionCode: '01', room: 'Room E', capacity: 20,
    meetings: [[5, '13:00', '14:00']] },

  // ── Semester 2 of the active year — THE D31 PROOF ──
  // The same course, the same section code, a DIFFERENT term. Under the old model these
  // would have collided with the rows above (one class row per course per YEAR); here they
  // are distinct offerings with their own rosters, assessments and gradebooks. Capacity is
  // null on both, which exercises the "no limit" branch nothing else covered.
  { key: 'MATH1110-01@S2', code: 'MATH1110', sectionCode: '01', semesterId: SEM_2025_2, room: 'Room A', capacity: null,
    meetings: [[1, '08:00', '09:30'], [3, '08:00', '09:30']] },
  { key: 'BIOL1102-01@S2', code: 'BIOL1102', sectionCode: '01', semesterId: SEM_2025_2, room: 'Lab 1', capacity: null,
    meetings: [[2, '09:00', '10:30'], [4, '09:00', '10:30']] },
];

/** Offering keys that belong to Semester 2 — used when seeding loads and assessments. */
const SEM2_KEYS = offeringSeed
  .filter((o) => o.semesterId === SEM_2025_2)
  .map((o) => o.key);

// ── Teachers (~12, Belizean names) ──────────────────────────────────────────────
type TeacherLike = 'active' | 'inactive';
type TeacherGender = 'male' | 'female';
const teacherSeed: ReadonlyArray<[string, string[], TeacherLike, TeacherGender]> = [
  ['Maria Reyes', ['MATH1110', 'MATH1210'], 'active', 'female'],
  ['Carlos Mendez', ['ENGL1102', 'HIST2102'], 'active', 'male'],
  ['Alicia Cano', ['BIOL1102', 'CHEM1100'], 'active', 'female'],
  ['Devon Flowers', ['MATH1210', 'MATH1110'], 'active', 'male'],
  ['Sonia Choc', ['SPAN2112', 'ENGL1102'], 'active', 'female'],
  ['Rodwell Bailey', ['SOCI1212', 'HIST2102'], 'active', 'male'],
  ['Yolanda Cruz', ['CHEM1100', 'BIOL1102'], 'active', 'female'],
  ['Egbert Grinage', ['THEO2201'], 'active', 'male'],
  ['Nadia Rhaburn', ['ITEC1104'], 'active', 'female'],
  ['Marlon Pou', ['MGMT1106', 'MATH1110'], 'active', 'male'],
  ['Kayla Waight', ['ENGL1102', 'ITEC1104'], 'active', 'female'],
  ['Trevor Neal', ['SOCI1212', 'THEO2201'], 'inactive', 'male'],
];
// Deterministic academic profile extras, rotated so the directory shows a believable mix.
const TEACHER_DESIGNATIONS = [
  'Head of Department',
  'Senior Lecturer',
  'Senior Lecturer',
  'Lecturer',
] as const;
const TEACHER_DEGREES: Record<(typeof TEACHER_DESIGNATIONS)[number], string> = {
  'Head of Department': 'M.Ed.',
  'Senior Lecturer': 'M.Sc.',
  Lecturer: 'B.Ed.',
};
const BELIZE_STREETS = [
  'Constitution Drive',
  'Forest Drive',
  'Melhado Parade',
  'Bliss Parade',
  'Hummingbird Avenue',
  'Ring Road',
] as const;
const teachers: DemoTeacher[] = teacherSeed.map(([full_name, specs, status, gender], i) => {
  // Specialisations are stored as course NAMES (that is what the directory shows),
  // resolved from the real catalog rather than an invented subject list.
  const specNames = specs.map((c) => courseName(c));
  const designation = TEACHER_DESIGNATIONS[i % TEACHER_DESIGNATIONS.length]!;
  const rng = makeRng(900 + i);
  const years = randInt(rng, 5, 22);
  return {
    id: `teach-${i + 1}`,
    user_id: status === 'active' ? `user-teach-${i + 1}` : null,
    staff_number: `T-${String(1001 + i)}`,
    full_name,
    email: `${full_name.toLowerCase().replace(/[^a-z]+/g, '.')}@belmopancomp.edu.bz`,
    phone: `+501-6${randInt(makeRng(700 + i), 100000, 999999)}`,
    subject_specializations: specNames,
    status,
    gender,
    designation,
    academic_qualification: `${TEACHER_DEGREES[designation]} ${specNames[0]}`,
    // D39 — the split names mirror what 013 backfilled in the real database.
    first_name: full_name.split(' ')[0],
    last_name: full_name.split(' ').slice(-1)[0],
    // Only the lead lecturer carries an SS# and a licence, so the demo shows both the
    // populated and the empty rendering of these fields rather than only one.
    ssno: i === 0 ? '000256398' : undefined,
    licensenum: i === 0 ? 'OWD-2019-00035' : undefined,
    bio: `${designation} with ${years} years of classroom experience teaching ${specNames[0]}. Committed to student-centred learning and measurable outcomes.`,
    address: `${randInt(rng, 1, 120)} ${pick(rng, BELIZE_STREETS)}, Belmopan, Cayo`,
    // Expertise derived from specializations; the lead subject rates highest.
    expertise: specNames.map((area, idx) => ({
      area,
      level: idx === 0 ? randInt(rng, 82, 95) : randInt(rng, 60, 85),
    })),
  };
});
const teacherByCode = (code: string): DemoTeacher => {
  const name = courseName(code);
  return teachers.find((t) => t.status === 'active' && t.subject_specializations.includes(name))!;
};
/** A NAMED active lecturer, for offerings that must not take the default specialist. */
const teacherByName = (fullName: string): DemoTeacher => {
  const found = teachers.find((t) => t.status === 'active' && t.full_name === fullName);
  if (!found) throw new Error(`demo dataset: no active lecturer named ${fullName}`);
  return found;
};

// ── offerings: one row per seed (D31) ───────────────────────────────────────────
//
// `off-N` lines up with `offeringSeed[N-1]`, which keeps the fixtures readable. There is no
// second table behind these: the D29 pair of `sec-N` + `cs-N` is this one row.
const offerings: DemoOffering[] = offeringSeed.map((o, i) => {
  const lead = o.teacherNames?.[0] ? teacherByName(o.teacherNames[0]) : teacherByCode(o.code);
  const extra = (o.teacherNames ?? []).slice(1).map((name) => teacherByName(name).id);
  // One co-taught offering so the "many lecturers on one offering" path (D16) is exercised.
  const coTeacher = o.key === 'MATH1110-01' ? teachers.find((tt) => tt.id === 'teach-4') : undefined;
  const teacher_ids = [
    lead.id,
    ...extra,
    ...(coTeacher && coTeacher.id !== lead.id ? [coTeacher.id] : []),
  ];
  return {
    id: `off-${i + 1}`,
    course_id: courseId(o.code),
    semester_id: o.semesterId ?? SEM_ACTIVE,
    section_code: o.sectionCode,
    capacity: o.capacity,
    is_archived: false,
    teacher_ids: [...new Set(teacher_ids)],
    lead_teacher_id: lead.id,
    // Drop-lowest on the Algebra offerings, so the D25 fallback is exercised by something.
    // This used to read `c.code === 'MATH'`, which never matched: 'MATH' is a PROGRAMME
    // code, not a course code, so the stored fallback was 0 everywhere and untested.
    drop_lowest_count: o.code === 'MATH1110' ? 1 : 0,
  };
});
/** Resolve a seed key to its offering row. Throws on a typo — a data error, not a soft miss. */
const offeringByKey = (key: string): DemoOffering => {
  const idx = offeringSeed.findIndex((o) => o.key === key);
  if (idx < 0) throw new Error(`demo dataset: no offering seeded with key ${key}`);
  return offerings[idx]!;
};

// ── offering_meetings: the weekly slot(s) each offering occupies ─────────────────
const offering_meetings: DemoOfferingMeeting[] = [];
let meetingCounter = 0;
offeringSeed.forEach((o, i) => {
  for (const [day, start, end] of o.meetings) {
    meetingCounter += 1;
    offering_meetings.push({
      id: `mtg-${meetingCounter}`,
      offering_id: `off-${i + 1}`,
      day_of_week: day,
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      room: o.room,
    });
  }
});

// ── Students (~45, Belizean names), each enrolled in SEVERAL offerings ──────────
const FIRST_NAMES = [
  'Ana', 'Luis', 'Keisha', 'Jamal', 'Sofia', 'Marco', 'Tanya', 'Elvin', 'Rina', 'Kester',
  'Denise', 'Andre', 'Shanice', 'Oscar', 'Mila', 'Trevaughn', 'Paola', 'Dwayne', 'Nayeli', 'Colin',
  'Britney', 'Hector', 'Jaylen', 'Marisol', 'Rueben', 'Alysha', 'Damian', 'Cindy', 'Kevaughn', 'Leah',
  'Ramon', 'Whitney', 'Isaias', 'Deja', 'Fernando', 'Kaylee', 'Osmond', 'Yuritzi', 'Bryce', 'Amara',
  'Delroy', 'Selena', 'Tyrique', 'Estela', 'Garrett',
];
const LAST_NAMES = [
  'Lopez', 'Garcia', 'Williams', 'Coye', 'Martinez', 'Gongora', 'Middleton', 'Requena', 'Tzul',
  'Flowers', 'Cacho', 'Vasquez', 'Rivera', 'Perez', 'Cattouse', 'Ake', 'Chan', 'Ical', 'Nunez',
  'Palacio',
];

/**
 * The course load each student takes, by year of study. A college student picks a handful of
 * courses rather than receiving a fixed set, so the generator rotates students through these
 * combinations — including the parallel Algebra sections, which is what makes any two
 * students' timetables genuinely different.
 *
 * Values are offering seed KEYS, so a typo throws at build rather than silently enrolling
 * nobody.
 */
const FIRST_YEAR_LOADS: ReadonlyArray<readonly string[]> = [
  ['MATH1110-01', 'BIOL1102-01', 'ENGL1102-01', 'CHEM1100-01'],
  ['MATH1110-02', 'BIOL1102-01', 'ENGL1102-01', 'ITEC1104-01'],
  ['MATH1110-01', 'BIOL1102-01', 'ENGL1102-01', 'ITEC1104-01'],
  ['MATH1110-02', 'CHEM1100-01', 'ENGL1102-01', 'ITEC1104-01'],
];
const SECOND_YEAR_LOADS: ReadonlyArray<readonly string[]> = [
  ['MATH1110-03', 'MATH1210-01', 'SPAN2112-01'],
  ['MGMT1106-01', 'SPAN2112-01', 'MATH1110-03'],
  ['MATH1110-03', 'MATH1210-01', 'MGMT1106-01'],
];

/**
 * The two named students the whole demo turns on. Hard-coded rather than generated so the
 * scenario cannot drift: same Biology, same English, DIFFERENT Algebra section.
 * `stu-1` is the seeded student login, so the demo lands on Freddy.
 */
const SCENARIO: Record<
  string,
  { name: string; yearOfStudy: 'First' | 'Second'; offerings: readonly string[] }
> = {
  'stu-1': {
    name: 'Freddy Lopez',
    yearOfStudy: 'First',
    offerings: ['MATH1110-01', 'BIOL1102-01', 'ENGL1102-01', 'CHEM1100-01'],
  },
  'stu-2': {
    name: 'John Garcia',
    yearOfStudy: 'First',
    offerings: ['MATH1110-02', 'BIOL1102-01', 'ENGL1102-01', 'ITEC1104-01'],
  },
};

/**
 * D32 - the religions the demo rotates through. `null` is IN the rotation on purpose:
 * a filter that has never met an unknown value is not tested.
 */
const DEMO_RELIGIONS: Array<string | null> = [
  'Catholic',
  'Anglican',
  null,
  'Adventist',
  'Methodist',
  null,
  'Catholic',
];

/**
 * D39 (Meeting #2 item 8) — the `religions` LOOKUP table, mirroring the two rows
 * `013_meeting2_schema.sql` seeded into live `sims`.
 *
 * Deliberately NOT the same list as `DEMO_RELIGIONS` above. The rotation assigned to
 * demo students includes 'Anglican' and 'Methodist', which this vocabulary does not
 * carry — so opening one of those students exercises the "(as recorded)" fallback in
 * `religionOptions` without needing a real legacy database. That fallback is the whole
 * reason `student_profiles.religion` stayed free text, and a demo where every student's
 * religion happened to be in the dropdown would never show it working.
 */
const religions: DemoReligion[] = [
  { id: 1, name: 'Catholic', code_name: 'CATH' },
  { id: 2, name: 'Seventh Day Adventist', code_name: 'SDA' },
];

/**
 * D33 — rotations for the rest of the admission form (asks 3 + 4).
 *
 * Deliberate NULLs and `false`s throughout, and they carry as much weight as the values:
 * the profile card omits an empty section, and a dataset where every student has a
 * financier and a next of kin would never exercise that. Roughly a third of each field is
 * left blank, which is what a real register of paper-and-admissions records looks like.
 */
const DEMO_CIVIL_STATUS: Array<string | null> = ['Single', 'Single', null, 'Single', 'Married'];
const DEMO_DISTRICTS: Array<District | null> = [
  'Cayo',
  'Belize',
  'Orange Walk',
  null,
  'Stann Creek',
  'Corozal',
  'Toledo',
];
const DEMO_LOADS: Array<EnrollmentLoad | null> = [
  'Full Time',
  'Full Time',
  'Part Time',
  null,
  'Full Time',
  'Transient',
];
const DEMO_NOK_RELATIONSHIPS: Array<string | null> = ['Mother', 'Father', 'Aunt', null, 'Uncle'];

const students: DemoStudent[] = [];
const rngStu = makeRng(4242);
/** studentId → the offering KEYS they take. Built alongside students, read by enrollments. */
const loadByStudent = new Map<string, readonly string[]>();
/**
 * Rotation position WITHIN each cohort, not the raw student index.
 *
 * `i % loads.length` is degenerate here, and the seeded data is what proved it: second-year
 * students are exactly the indices where `i % 3 === 2`, so `i % 3` picked
 * `SECOND_YEAR_LOADS[2]` for all 15 of them — two of the three second-year combinations were
 * unreachable and `SPAN2112-01` ended up an offering with an EMPTY roster. Counting within
 * the cohort is what makes the rotation actually rotate.
 */
const cohortSeen: Record<'First' | 'Second', number> = { First: 0, Second: 0 };

for (let i = 0; i < 45; i += 1) {
  const id = `stu-${i + 1}`;
  const scenario = SCENARIO[id];
  // Roughly two-thirds first-year (the larger intake), the rest second-year.
  const yearOfStudy: 'First' | 'Second' =
    scenario?.yearOfStudy ?? (i % 3 === 2 ? 'Second' : 'First');
  const rotation = cohortSeen[yearOfStudy];
  cohortSeen[yearOfStudy] += 1;
  const first = FIRST_NAMES[i]!;
  const last = pick(rngStu, LAST_NAMES);
  // Junior-college entrants are ~16-18: first-year born ~2008, second-year ~2007.
  const birthYear = yearOfStudy === 'Second' ? 2007 : 2008;
  const dob = `${birthYear}-${String(randInt(rngStu, 1, 12)).padStart(2, '0')}-${String(
    randInt(rngStu, 1, 28),
  ).padStart(2, '0')}`;
  // Mostly Registered; a few of every other state for realism. The two scenario
  // students are always Registered — the demo depends on their timetables rendering.
  // D34 renamed the vocabulary (active→Registered, inactive→Unregistered) and added
  // DropOut, which is seeded here so the register has one to show.
  let status: DemoStudent['status'] = 'Registered';
  if (!scenario) {
    if (i === 7) status = 'Unregistered';
    else if (i === 20) status = 'withdrawn';
    else if (i === 33) status = 'transferred';
    else if (i === 41) status = 'graduated';
    else if (i === 28) status = 'DropOut';
  }
  // D30 §D10: the parts are primary; `full_name` is derived from them, never the
  // other way round. Scenario students carry a fixed display name, so it is split
  // the same way the migration split the legacy column.
  const [firstName, ...restName] = (scenario?.name ?? `${first} ${last}`).split(' ');
  const lastName = restName.length ? restName[restName.length - 1]! : firstName!;
  const middleName = restName.slice(0, -1).join(' ') || null;
  const full_name = [firstName, middleName, lastName].filter(Boolean).join(' ');

  // Graduated / withdrawn students hold no active enrollment.
  const load =
    status === 'graduated' || status === 'withdrawn'
      ? []
      : (scenario?.offerings ??
        (yearOfStudy === 'Second'
          ? SECOND_YEAR_LOADS[rotation % SECOND_YEAR_LOADS.length]!
          : FIRST_YEAR_LOADS[rotation % FIRST_YEAR_LOADS.length]!));
  loadByStudent.set(id, load);

  students.push({
    id,
    user_id: i < 6 ? `user-stu-${i + 1}` : null, // first few have logins (demo student login)
    student_number: `S-${String(25001 + i)}`,
    first_name: firstName!,
    middle_name: middleName,
    last_name: lastName,
    full_name,
    date_of_birth: dob,
    // D32 fixed a data artefact here. This was `i % 2`, and the programme rotation below
    // is `i % 8` - so every student on a given programme shared an index parity and
    // therefore a GENDER. "Female students in Programme X" returned all of Programme X,
    // which makes the brief's headline combination filter impossible to demonstrate.
    // Adding `floor(i / 8)` breaks the alignment while keeping the overall split even.
    gender: (i + Math.floor(i / BAJC_PROGRAMS.length)) % 2 === 0 ? 'female' : 'male',
    // D32 (brief §3) - rotated across four denominations plus "not stated", because the
    // filter has to be demonstrable and the live database has this NULL for everyone
    // (only the admissions form collects it, and no application has been processed).
    // The deliberate NULLs matter as much as the values: "All religions" must not
    // silently mean "the ones we happen to know".
    religion: DEMO_RELIGIONS[i % DEMO_RELIGIONS.length]!,
    enrollment_date: '2025-09-01',
    status,
    year_of_study: yearOfStudy,
    // D30 §D12 — every demo student is registered on a real BAJC programme, rotated
    // deterministically. Primary Education is deliberately in the rotation: it is the
    // one programme that passes at C (2.00) rather than C+ (2.50), so the
    // per-programme pass mark is exercised rather than merely stored.
    program_id: `prog-${BAJC_PROGRAMS[i % BAJC_PROGRAMS.length]![0].toLowerCase()}`,
    guardian_name: `${pick(rngStu, FIRST_NAMES)} ${last}`,
    guardian_phone: `+501-6${randInt(rngStu, 100000, 999999)}`,
    guardian_email: `${last.toLowerCase()}.guardian@example.bz`,
    address: `${randInt(rngStu, 1, 99)} ${pick(rngStu, ['Cedar', 'Mahogany', 'Bougainvillea', 'Hibiscus'])} Street, Belmopan`,
    phone: `+501-6${randInt(rngStu, 100000, 999999)}`,
    // ── D33: the rest of the admission form ──────────────────────────────────
    // The SSN is null for a third of the register: it is transcribed off a card, and the
    // card is often the document still missing when the student is registered.
    ssno: i % 3 === 1 ? null : `${String(100000000 + i * 7919).slice(0, 9)}`,
    civil_status: DEMO_CIVIL_STATUS[i % DEMO_CIVIL_STATUS.length]!,
    street: `${randInt(rngStu, 1, 99)} ${pick(rngStu, ['Cedar', 'Mahogany', 'Bougainvillea', 'Hibiscus'])} Street`,
    city_town_village: pick(rngStu, ['Belmopan', 'Belize City', 'San Ignacio', 'Orange Walk Town']),
    district: DEMO_DISTRICTS[i % DEMO_DISTRICTS.length]!,
    mother_name: i % 4 === 3 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    father_name: i % 5 === 4 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    nok_name: i % 6 === 5 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    nok_relationship: DEMO_NOK_RELATIONSHIPS[i % DEMO_NOK_RELATIONSHIPS.length]!,
    nok_phone: i % 6 === 5 ? null : `+501-6${randInt(rngStu, 100000, 999999)}`,
    // A handful, so the Health section is demonstrable without being the norm.
    has_health_condition: i % 11 === 3,
    health_condition_note: i % 11 === 3 ? 'Asthma — inhaler kept with the school nurse.' : null,
    atlib_exam: i % 3 === 0,
    num_csec: i % 7 === 6 ? null : randInt(rngStu, 4, 9),
    finance_name: i % 3 === 2 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    finance_phone: i % 3 === 2 ? null : `+501-6${randInt(rngStu, 100000, 999999)}`,
    finance_email: i % 3 === 2 ? null : `${last.toLowerCase()}.finance@example.bz`,
    enrollment_load: DEMO_LOADS[i % DEMO_LOADS.length]!,
    // ── D34 · the client's own columns ───────────────────────────────────────
    // Sparse on purpose: most are the office's record-keeping about a record, and a
    // dataset where every student had a transfer origin and a drop-out reason would
    // never exercise the profile card's empty-section handling.
    student_id_original: i % 5 === 0 ? 20000 + i : null,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@student.bajc.edu.bz`,
    transferred_from: status === 'transferred' ? 'Belize High School' : null,
    graduation_date: status === 'graduated' ? '2026-06-19' : null,
    dropout_date: status === 'DropOut' ? '2026-03-02T00:00:00Z' : null,
    dropout_reason: status === 'DropOut' ? 'Relocated abroad mid-semester.' : null,
    comments: i % 9 === 4 ? 'Fee plan agreed with the bursar.' : null,
    origin: i < 6 ? 'admissions' : 'import-2025',
    // No FK and no consumer — mirrored only so the demo shape matches the wire.
    educationbg_id: null,
    doc_id: null,
  });
}

// ── Enrollments: MANY per student — one row per offering they take ──────────────
//
// An enrollment's `semester_id` now MUST agree with its offering's: an offering belongs to
// one term, so a Semester-1 offering cannot hold a Semester-2 enrollment. It is read off the
// offering rather than passed in, which makes that impossible to get wrong here.
const enrollments: DemoEnrollment[] = [];
let enrollCounter = 0;
function enrol(studentId: string, offering: DemoOffering, unenrolledAt: string | null = null) {
  enrollCounter += 1;
  enrollments.push({
    id: `enr-${enrollCounter}`,
    student_id: studentId,
    offering_id: offering.id,
    semester_id: offering.semester_id,
    enrolled_at: offering.semester_id === SEM_ACTIVE ? '2025-09-01T08:00:00Z' : '2026-01-19T08:00:00Z',
    unenrolled_at: unenrolledAt,
    // D35 — ordinary by default. `seedCourseStatuses()` below marks a few afterwards, so
    // the register has an audit and a withdrawal to show without every row being unusual.
    enrollment_status: 'enrolled',
  });
}

for (const stu of students) {
  for (const key of loadByStudent.get(stu.id) ?? []) {
    enrol(stu.id, offeringByKey(key));
  }
}

/**
 * Semester 2 continuation. Every student carrying a Semester-1 offering of a course also
 * enrols in that course's Semester-2 offering, so the year·semester switcher shows a real,
 * DIFFERENT term rather than an empty table — which was indistinguishable from the filter
 * being broken.
 *
 * Matching is by COURSE, not by section: a student in MATH1110-02 continues into the single
 * Semester-2 section of MATH1110, which is exactly how a real registration works.
 */
for (const stu of students) {
  const sem1CourseIds = new Set(
    (loadByStudent.get(stu.id) ?? []).map((key) => offeringByKey(key).course_id),
  );
  for (const key of SEM2_KEYS) {
    const offering = offeringByKey(key);
    if (sem1CourseIds.has(offering.course_id)) enrol(stu.id, offering);
  }
}

// One student switched Algebra sections mid-term: a closed row on -01 plus an active row on
// -02. This is a genuine SWITCH of one offering, not the old whole-student "transfer" — and
// it exercises the "grade rows ∪ active roster" path in Module 3.
const switchStudent = students.find((s) => s.status === 'transferred');
if (switchStudent) {
  enrol(switchStudent.id, offeringByKey('MATH1110-01'), '2025-09-25T08:00:00Z');
}

/** Active roster of one offering, in its OWN term. */
function activeRoster(offeringId: string): DemoStudent[] {
  const offering = offerings.find((o) => o.id === offeringId);
  if (!offering) return [];
  const enrolledIds = enrollments
    .filter(
      (e) =>
        e.offering_id === offeringId &&
        e.semester_id === offering.semester_id &&
        !e.unenrolled_at,
    )
    .map((e) => e.student_id);
  return students.filter((s) => enrolledIds.includes(s.id));
}
function activeEnrollment(studentId: string, offeringId: string): DemoEnrollment | undefined {
  return enrollments.find(
    (e) => e.student_id === studentId && e.offering_id === offeringId && !e.unenrolled_at,
  );
}

// ── Assessment categories: Quizzes + Tests on every offering ────────────────────
const assessment_categories: DemoAssessmentCategory[] = [];
for (const off of offerings) {
  assessment_categories.push(
    { id: `cat-${off.id}-q`, offering_id: off.id, name: 'Quizzes', weight: 0.4, drop_lowest_count: 1 },
    { id: `cat-${off.id}-t`, offering_id: off.id, name: 'Tests', weight: 0.6, drop_lowest_count: 0 },
  );
}

// ── Assessments: a few per offering (quiz/test/project mix) ─────────────────────
//
// **D31 changed where an assessment's term comes from, and it matters.** Under the
// year-scoped model an assessment carried its own `semester_id` independently of its
// class_subject, so the same gradebook held both terms' work and the seed picked a term per
// TEMPLATE. An offering belongs to ONE term now, so the term is read off the offering — a
// Semester-1 offering cannot hold a Semester-2 assessment, and the seed cannot express one.
//
// The year·semester switcher stays demonstrable because Semester 2 has its own OFFERINGS
// (see `offeringSeed`) with their own rosters. That is a better demo than before: switching
// terms changes which courses appear, not just which rows inside one course.
//
// Semester-1 rows are anchored to DEMO_TODAY (2025-10-15), inside that term's window.
// Semester-2 rows carry absolute dates inside `sem-2025-2` (2026-01-19 → 2026-06-26), which
// is after DEMO_TODAY — so they are `published`/unreleased: an upcoming term, which is both
// realistic and what a student would expect to see there.
const assessments: DemoAssessment[] = [];
let asmtCounter = 0;
interface AsmtTemplate {
  title: string;
  type: DemoAssessment['type'];
  catSuffix: 'q' | 't' | null;
  max: number;
  weight: number;
  /** Days from DEMO_TODAY; used when `date` is absent. */
  offsetDays: number;
  /** Absolute date, for a term whose window is nowhere near DEMO_TODAY. */
  date?: string;
  status: DemoAssessment['status'];
  released: boolean;
}
const SEM1_ASMT_TEMPLATES: readonly AsmtTemplate[] = [
  { title: 'Quiz 1', type: 'quiz', catSuffix: 'q', max: 20, weight: 1, offsetDays: -30, status: 'graded', released: true },
  { title: 'Quiz 2', type: 'quiz', catSuffix: 'q', max: 20, weight: 1, offsetDays: -16, status: 'graded', released: true },
  { title: 'Unit Test 1', type: 'test', catSuffix: 't', max: 50, weight: 1, offsetDays: -9, status: 'graded', released: false },
  { title: 'Project', type: 'assignment', catSuffix: null, max: 100, weight: 1, offsetDays: 7, status: 'published', released: false },
];
const SEM2_ASMT_TEMPLATES: readonly AsmtTemplate[] = [
  { title: 'Quiz 1', type: 'quiz', catSuffix: 'q', max: 20, weight: 1, offsetDays: 0, date: '2026-02-10', status: 'published', released: false },
  { title: 'Mid-Session Exam', type: 'exam', catSuffix: 't', max: 100, weight: 2, offsetDays: 0, date: '2026-03-18', status: 'published', released: false },
];
for (const off of offerings) {
  if (off.is_archived) continue;
  const templates = off.semester_id === SEM_ACTIVE ? SEM1_ASMT_TEMPLATES : SEM2_ASMT_TEMPLATES;
  for (const tmpl of templates) {
    asmtCounter += 1;
    assessments.push({
      id: `asmt-${asmtCounter}`,
      offering_id: off.id,
      // Denormalised from the offering, never chosen independently of it.
      semester_id: off.semester_id,
      category_id: tmpl.catSuffix ? `cat-${off.id}-${tmpl.catSuffix}` : null,
      title: tmpl.title,
      type: tmpl.type,
      max_score: tmpl.max,
      weight: tmpl.weight,
      assessment_date: tmpl.date ?? addDays(DEMO_TODAY, tmpl.offsetDays),
      status: tmpl.status,
      is_released: tmpl.released,
    });
  }
}

// ── Assessment grades: scores for enrolled students on graded/past assessments ──
const assessment_grades: DemoAssessmentGrade[] = [];
const rngGrade = makeRng(31337);
let gradeCounter = 0;
for (const asmt of assessments) {
  const roster = activeRoster(asmt.offering_id);
  for (const stu of roster) {
    const enr = activeEnrollment(stu.id, asmt.offering_id);
    if (!enr) continue;
    gradeCounter += 1;
    let status: GradeStatus;
    let score: number | null = null;
    if (asmt.status === 'graded') {
      // Mostly graded; sprinkle absent/excused/pending to exercise all states.
      const roll = rngGrade();
      if (roll < 0.06) status = 'absent';
      else if (roll < 0.1) status = 'excused';
      else if (roll < 0.12) status = 'pending';
      else {
        status = 'graded';
        // Centred on 84%, not 75%, and clamped to [0, max]. The old centre was written
        // against the pre-D30 5-band scale where 60 passed and 90 was an A; D30 moved
        // BAJC's pass mark to 70 and put A at 95 WITHOUT re-centring this line, so the
        // demo showed a college with a ~37% failure rate — and Freddy Lopez, the student
        // demo mode lands on, held a D. The scale change made the same numbers mean
        // something different, which no typecheck could notice.
        const pct = Math.min(1, Math.max(0.45, 0.84 + (rngGrade() - 0.5) * 0.3));
        score = Math.round(pct * asmt.max_score);
      }
    } else {
      status = 'pending';
    }
    assessment_grades.push({
      id: `grd-${gradeCounter}`,
      assessment_id: asmt.id,
      student_id: stu.id,
      enrollment_id: enr.id,
      status,
      score,
      makeup_score: null,
      is_released: null, // inherit assessment.is_released
    });
  }
}

// ── Attendance: recent ~2 weeks of daily per-offering records ───────────────────
//
// Only the ACTIVE term's offerings get records: attendance is taken in the term a course
// actually runs, and DEMO_TODAY sits in Semester 1. Seeding the Semester-2 offerings would
// claim a register was taken four months before the term opened.
const attendance_records: DemoAttendanceRecord[] = [];
const rngAtt = makeRng(55555);
let attCounter = 0;
// Build the list of weekdays in the 14-day window ending at DEMO_TODAY.
const attDates: string[] = [];
for (let d = -13; d <= 0; d += 1) {
  const iso = addDays(DEMO_TODAY, d);
  if (isWeekday(iso)) attDates.push(iso);
}
const principalUserId = 'user-principal';
// The lecturer who records it. This used to be `teacherByCode('MATH')`, which THREW:
// 'MATH' is a PROGRAMME code and `courseName` only knows course codes, so building the
// dataset raised "no BAJC course with code MATH" and demo mode died at import.
const attendanceRecorderUserId = teacherByCode('MATH1110').user_id ?? principalUserId;
for (const off of offerings.filter((o) => o.semester_id === SEM_ACTIVE)) {
  const roster = activeRoster(off.id);
  for (const date of attDates) {
    for (const stu of roster) {
      const enr = activeEnrollment(stu.id, off.id);
      if (!enr) continue;
      attCounter += 1;
      const roll = rngAtt();
      // ~90% present, believable absent/late/excused split.
      let status: AttendanceStatus;
      if (roll < 0.9) status = 'present';
      else if (roll < 0.95) status = 'absent';
      else if (roll < 0.98) status = 'late';
      else status = 'excused';
      attendance_records.push({
        id: `att-${attCounter}`,
        offering_id: off.id,
        student_id: stu.id,
        enrollment_id: enr.id,
        semester_id: SEM_ACTIVE,
        attendance_date: date,
        status,
        recorded_by_user_id: attendanceRecorderUserId,
        recorded_at: `${date}T08:15:00Z`,
      });
    }
  }
}

// ── Announcements (~6) with audiences + read-state ──────────────────────────────
const announcements: DemoAnnouncement[] = [
  {
    id: 'ann-1',
    title: 'Welcome back to the 2025-2026 school year',
    body: 'Classes resume Monday. Please collect timetables from the front office and review the updated code of conduct posted on the notice board.',
    audience: 'all',
    offering_id: null,
    author_user_id: principalUserId,
    published_at: addDays(DEMO_TODAY, -20) + 'T08:00:00Z',
    expires_at: null,
    read_by_user_ids: ['user-teach-1', 'user-stu-1'],
  },
  {
    id: 'ann-2',
    title: 'Staff meeting — Thursday 3:30 PM',
    body: 'All teaching staff should attend the session-planning meeting in the staff room. Department heads, please bring your assessment calendars.',
    audience: 'teachers',
    offering_id: null,
    author_user_id: principalUserId,
    published_at: addDays(DEMO_TODAY, -6) + 'T14:00:00Z',
    expires_at: addDays(DEMO_TODAY, 2) + 'T00:00:00Z',
    read_by_user_ids: ['user-teach-1'],
  },
  {
    id: 'ann-3',
    title: 'Mid-session exam schedule released',
    body: 'The mid-session timetable is now available. Review your subjects and prepare accordingly. Speak to your lecturers about any clashes.',
    audience: 'students',
    offering_id: null,
    author_user_id: 'user-secretary',
    published_at: addDays(DEMO_TODAY, -4) + 'T10:00:00Z',
    expires_at: null,
    read_by_user_ids: [],
  },
  {
    id: 'ann-4',
    // Targeted at ONE OFFERING (D31). The audience enum keeps its `'class'` member — it is a
    // wire value shared by the ORM, API and handlers — but what it points at is an offering.
    title: 'BIOL1102-01 — bring lab coats Friday',
    body: 'For our first Biology practical this Friday, everyone in BIOL1102-01 must bring a lab coat and closed-toe shoes.',
    audience: 'class',
    offering_id: offeringByKey('BIOL1102-01').id,
    author_user_id: 'user-teach-3',
    published_at: addDays(DEMO_TODAY, -2) + 'T11:30:00Z',
    expires_at: addDays(DEMO_TODAY, 3) + 'T00:00:00Z',
    read_by_user_ids: [],
  },
  {
    id: 'ann-5',
    title: 'Sports Day — save the date',
    body: 'Annual Sports Day is scheduled for next month. House captains will be announced shortly. Get your teams ready!',
    audience: 'all',
    offering_id: null,
    author_user_id: 'user-teach-8',
    published_at: addDays(DEMO_TODAY, -1) + 'T09:00:00Z',
    expires_at: null,
    read_by_user_ids: [],
  },
  {
    id: 'ann-6',
    title: 'Library closed for stocktake (expired)',
    body: 'The library was closed last week for the annual stocktake. It has since reopened for normal hours.',
    audience: 'all',
    offering_id: null,
    author_user_id: 'user-secretary',
    published_at: addDays(DEMO_TODAY, -12) + 'T08:00:00Z',
    expires_at: addDays(DEMO_TODAY, -8) + 'T00:00:00Z', // already expired
    read_by_user_ids: ['user-teach-1', 'user-stu-1'],
  },
];

// ── Calendar events (school-wide; authored by principal/secretary) ──────────────
// Spread around DEMO_TODAY (2025-10-15) so the calendar opens onto a lively month,
// with a couple of next-month entries to make month navigation meaningful. Belize
// public holidays are used where they fall in-window.
const eventCreatedAt = addDays(DEMO_TODAY, -25) + 'T08:00:00Z';
const events: DemoEvent[] = [
  {
    id: 'evt-1',
    title: 'Staff Development Day',
    description: 'No classes for students. All teaching staff attend professional-development workshops.',
    category: 'meeting',
    visibility: 'internal',
    start_date: addDays(DEMO_TODAY, -6),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: 'Main Hall',
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-2',
    title: 'Pan American Day',
    description: 'Public holiday — school closed.',
    category: 'holiday',
    visibility: 'global',
    start_date: addDays(DEMO_TODAY, -3),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: 'user-secretary',
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-3',
    title: 'School Photo Day',
    description: 'Class and individual photographs. Students must be in full uniform.',
    category: 'activity',
    visibility: 'global',
    start_date: DEMO_TODAY,
    end_date: null,
    all_day: false,
    start_time: '09:00',
    end_time: '12:00',
    location: 'Gymnasium',
    created_by_user_id: 'user-secretary',
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-4',
    title: 'Session Planning — Staff Meeting',
    description: 'All teaching staff meet to review the mid-session timetable and assessment calendar.',
    category: 'meeting',
    visibility: 'internal',
    start_date: addDays(DEMO_TODAY, 1),
    end_date: null,
    all_day: false,
    start_time: '17:00',
    end_time: '18:30',
    location: 'Auditorium',
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-5',
    title: 'Mid-Session Examinations',
    description: 'Mid-session exams across all forms. Refer to the posted timetable for your subjects.',
    category: 'exam',
    visibility: 'global',
    start_date: addDays(DEMO_TODAY, 5),
    end_date: addDays(DEMO_TODAY, 9),
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-6',
    title: 'Inter-House Sports Day',
    description: 'Annual athletics competition between houses. Family and friends welcome to attend.',
    category: 'activity',
    visibility: 'global',
    start_date: addDays(DEMO_TODAY, 12),
    end_date: null,
    all_day: false,
    start_time: '08:00',
    end_time: '14:00',
    location: 'Sports Field',
    created_by_user_id: 'user-secretary',
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-7',
    title: 'First-Session Report Cards Issued',
    description: 'Report cards for the first session are released to students and guardians.',
    category: 'other',
    visibility: 'global',
    start_date: addDays(DEMO_TODAY, 16),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: 'user-secretary',
    created_at: eventCreatedAt,
  },
  {
    id: 'evt-8',
    title: 'Garifuna Settlement Day',
    description: 'National public holiday — school closed.',
    category: 'holiday',
    visibility: 'global',
    start_date: addDays(DEMO_TODAY, 35),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt,
  },
];

// ── Grading scale + bands ───────────────────────────────────────────────────────
// The BAJC 8-band scale with grade points, mirroring
// `backend/app/modules/settings/grading_defaults.py` (D30 §D5). Ceilings are the
// integers BAJC prints, not the old `.99` dressing — safe because `letterFor` is
// half-open on `min_score`.
//
// **D and F are both non-passing.** D is priced 1.00, below every programme's
// `min_passing_grade_point` (2.00 for Primary Education, 2.50 elsewhere), so marking it
// passing would have made the letter semantics and the programme rule disagree. The
// pass mark is 70 — C's floor — for the same reason.
const activeBands: DemoGradingScale['bands'] = [
  { letter: 'A', min_score: 95, max_score: 100, grade_point: 4.0, is_passing: true, sort_order: 1 },
  { letter: 'A-', min_score: 90, max_score: 94, grade_point: 3.75, is_passing: true, sort_order: 2 },
  { letter: 'B+', min_score: 85, max_score: 89, grade_point: 3.5, is_passing: true, sort_order: 3 },
  { letter: 'B', min_score: 80, max_score: 84, grade_point: 3.0, is_passing: true, sort_order: 4 },
  { letter: 'C+', min_score: 75, max_score: 79, grade_point: 2.5, is_passing: true, sort_order: 5 },
  { letter: 'C', min_score: 70, max_score: 74, grade_point: 2.0, is_passing: true, sort_order: 6 },
  { letter: 'D', min_score: 65, max_score: 69, grade_point: 1.0, is_passing: false, sort_order: 7 },
  { letter: 'F', min_score: 0, max_score: 64, grade_point: 0.0, is_passing: false, sort_order: 8 },
];
// The ARCHIVED year deliberately keeps the pre-D30 5-band scale with NULL grade points.
// That is not laziness: a frozen scale keeps the rules that were in force then (schema
// §10.4), and it is the state that exercises `meets_grade_point`'s lenient fallback in
// demo mode exactly as the real database does.
const archivedBands: DemoGradingScale['bands'] = [
  { letter: 'A', min_score: 90, max_score: 100, grade_point: null, is_passing: true, sort_order: 1 },
  { letter: 'B', min_score: 80, max_score: 89.99, grade_point: null, is_passing: true, sort_order: 2 },
  { letter: 'C', min_score: 70, max_score: 79.99, grade_point: null, is_passing: true, sort_order: 3 },
  { letter: 'D', min_score: 60, max_score: 69.99, grade_point: null, is_passing: true, sort_order: 4 },
  { letter: 'F', min_score: 0, max_score: 59.99, grade_point: null, is_passing: false, sort_order: 5 },
];
const grading_scales: DemoGradingScale[] = [
  { academic_year_id: YEAR_ACTIVE, pass_mark: 70, is_frozen: false, bands: activeBands },
  {
    academic_year_id: YEAR_ARCHIVED,
    pass_mark: 60,
    is_frozen: true,
    bands: archivedBands,
  },
];

const assessment_policy: DemoAssessmentPolicy = {
  absent_as_zero: true,
  allow_makeup: true,
  drop_lowest_count: 0,
  // D32 - seeded ON, unlike the server default. The demo's whole point is showing the
  // student experience, and a student with grades hidden has almost no screens left. To
  // see the hidden state, turn it off in Settings -> Assessment policy and reload as the
  // student: My Grades disappears from the nav and /grades redirects to /forbidden.
  students_can_view_grades: true,
};

// ── Users (login accounts backing Settings › Users + auth) ──────────────────────
const users: DemoUser[] = [];
function pushUser(u: Omit<DemoUser, 'locale' | 'theme' | 'date_format' | 'default_page_size'>): void {
  users.push({ locale: 'en', theme: 'light', date_format: null, default_page_size: 25, ...u });
}
pushUser({
  id: principalUserId,
  email: 'principal@belmopancomp.edu.bz',
  username: 'principal',
  full_name: 'Alicia Mendez',
  role: 'principal',
  is_active: true,
  must_change_password: false,
  last_login_at: DEMO_TODAY_ISO,
});
pushUser({
  id: 'user-secretary',
  email: 'secretary@belmopancomp.edu.bz',
  username: 'secretary',
  full_name: 'Sofia Castillo',
  role: 'secretary',
  is_active: true,
  must_change_password: false,
  last_login_at: addDays(DEMO_TODAY, -1) + 'T07:45:00Z',
});
for (const t of teachers) {
  if (!t.user_id) continue;
  pushUser({
    id: t.user_id,
    email: t.email,
    username: t.email.split('@')[0]!,
    full_name: t.full_name,
    role: 'teacher',
    is_active: t.status === 'active',
    must_change_password: false,
    last_login_at: addDays(DEMO_TODAY, -randInt(makeRng(t.id.length + 3), 0, 5)) + 'T07:50:00Z',
  });
}
for (const s of students) {
  if (!s.user_id) continue;
  pushUser({
    id: s.user_id,
    email: `${s.student_number.toLowerCase()}@student.belmopancomp.edu.bz`,
    username: s.student_number.toLowerCase(),
    full_name: s.full_name,
    role: 'student',
    is_active: s.status === 'Registered',
    must_change_password: false,
    last_login_at: addDays(DEMO_TODAY, -randInt(makeRng(s.id.length + 9), 0, 7)) + 'T15:00:00Z',
  });
}

// ── Historical year (2024-2025) — a full parallel dataset ───────────────────────
// So the per-module year switcher shows populated, DISTINCT data when a past year
// is selected. Same students/teachers/courses (those entities persist across years);
// separate offerings, enrollments, assessments, grades and attendance, all tagged to the
// archived year's Semester 1 (`sem-2024-1`).
const HIST_ANCHOR = '2025-01-10'; // a weekday inside Semester 1 of 2024-2025
const SEM_2024_1 = 'sem-2024-1';

// Historical offerings mirror the active structure but sit in the archived year's term.
// They carry is_archived=true so every existing "active" filter keeps excluding them by
// default — current screens are unchanged. The per-module year switcher reaches them by
// resolving the year through their semester.
//
// **D31 makes the mirror simpler AND more correct.** It used to build two parallel tables
// (`sec-2024-N` + `cs-2024-N`) and it scoped them by `academic_year_id`, which meant the
// archived year's offerings could not say WHICH term they belonged to; now `semester_id`
// says it directly. Only the SEMESTER-1 active offerings are mirrored: the Semester-2 rows
// are this year's continuation and have no last-year twin.
//
// They get no `offering_meetings`: a timetable is about where to be now, and reconstructing
// an archived week would imply the schedule is historical data, which it is not.
const histSeed = offeringSeed.filter((o) => (o.semesterId ?? SEM_ACTIVE) === SEM_ACTIVE);
const histOfferings: DemoOffering[] = histSeed.map((o, i) => {
  const lead = o.teacherNames?.[0] ? teacherByName(o.teacherNames[0]) : teacherByCode(o.code);
  return {
    id: `off-2024-${i + 1}`,
    course_id: courseId(o.code),
    semester_id: SEM_2024_1,
    section_code: o.sectionCode,
    capacity: o.capacity,
    is_archived: true,
    teacher_ids: [lead.id],
    lead_teacher_id: lead.id,
    drop_lowest_count: o.code === 'MATH1110' ? 1 : 0,
  };
});
// Trevor Neal (inactive, `teach-12`) holds NO offering assignment, in either year, and that
// is now stated rather than attempted. Two successive versions tried to give him a historical
// one and both were dead code: the first looked for `subjectId('GEO')` and the second for
// `courseId('THEO2201')` — neither is offered by `offeringSeed`, so `.find` returned undefined
// and the push never ran. An inactive lecturer with no classes is a real and useful state (it
// is what "inactive" means), so the honest fix is to drop the pretence; giving him a course he
// does not specialise in would be inventing data to satisfy a comment.
offerings.push(...histOfferings);

for (const off of histOfferings) {
  assessment_categories.push(
    { id: `cat-${off.id}-q`, offering_id: off.id, name: 'Quizzes', weight: 0.4, drop_lowest_count: 1 },
    { id: `cat-${off.id}-t`, offering_id: off.id, name: 'Tests', weight: 0.6, drop_lowest_count: 0 },
  );
}

// Historical enrollments: give each student the SAME course load they carry this year,
// against last year's twin of each offering. Many rows per student, not one, so a past-year
// profile shows a full load rather than a single class.
//
// Graduated / withdrawn students hold no CURRENT load but did sit last year, so they fall
// back to the first-year default set — otherwise the archived year would show them enrolled
// in nothing, which is exactly the record a transcript needs.
const histEnrollmentId = new Map<string, string>(); // `${studentId}:${offeringId}` -> enrollment_id
let histEnrollCounter = 0;
/** Active-year offering id → its archived-year twin. */
const histTwinByOfferingId = new Map<string, DemoOffering>(
  histSeed.map((o, i) => [offeringByKey(o.key).id, histOfferings[i]!]),
);
for (const stu of students) {
  const current = loadByStudent.get(stu.id) ?? [];
  const keys = current.length > 0 ? current : FIRST_YEAR_LOADS[0]!;
  for (const key of keys) {
    const twin = histTwinByOfferingId.get(offeringByKey(key).id);
    // A Semester-2 key has no last-year twin; skip rather than inventing one.
    if (!twin) continue;
    histEnrollCounter += 1;
    const enrId = `enr-2024-${histEnrollCounter}`;
    enrollments.push({
      id: enrId,
      student_id: stu.id,
      offering_id: twin.id,
      semester_id: SEM_2024_1,
      enrolled_at: '2024-09-02T08:00:00Z',
      unenrolled_at: null,
      // D35 — last year's rows are ordinary registrations.
      enrollment_status: 'enrolled',
    });
    histEnrollmentId.set(`${stu.id}:${twin.id}`, enrId);
  }
}
function histRoster(offeringId: string): DemoStudent[] {
  const ids = enrollments
    .filter((e) => e.offering_id === offeringId && e.semester_id === SEM_2024_1 && !e.unenrolled_at)
    .map((e) => e.student_id);
  return students.filter((s) => ids.includes(s.id));
}

// Historical assessments — the year is complete, so all are graded + released.
const HIST_ASMT_TEMPLATES: ReadonlyArray<{
  title: string;
  type: DemoAssessment['type'];
  catSuffix: 'q' | 't' | null;
  max: number;
  offsetDays: number;
}> = [
  { title: 'Quiz 1', type: 'quiz', catSuffix: 'q', max: 20, offsetDays: -90 },
  { title: 'Quiz 2', type: 'quiz', catSuffix: 'q', max: 20, offsetDays: -60 },
  { title: 'Mid-Session Test', type: 'test', catSuffix: 't', max: 50, offsetDays: -30 },
  { title: 'Final Project', type: 'assignment', catSuffix: null, max: 100, offsetDays: -10 },
];
const histAssessments: DemoAssessment[] = [];
let histAsmtCounter = 0;
for (const off of histOfferings) {
  for (const tmpl of HIST_ASMT_TEMPLATES) {
    histAsmtCounter += 1;
    histAssessments.push({
      id: `asmt-2024-${histAsmtCounter}`,
      offering_id: off.id,
      semester_id: SEM_2024_1,
      category_id: tmpl.catSuffix ? `cat-${off.id}-${tmpl.catSuffix}` : null,
      title: tmpl.title,
      type: tmpl.type,
      max_score: tmpl.max,
      weight: 1,
      assessment_date: addDays(HIST_ANCHOR, tmpl.offsetDays),
      status: 'graded',
      is_released: true,
    });
  }
}
assessments.push(...histAssessments);

// Historical grades — believable scores (~78% centre), a few absent/excused.
const rngHistGrade = makeRng(24680);
let histGradeCounter = 0;
for (const asmt of histAssessments) {
  for (const stu of histRoster(asmt.offering_id)) {
    const enrId = histEnrollmentId.get(`${stu.id}:${asmt.offering_id}`);
    if (!enrId) continue;
    histGradeCounter += 1;
    const roll = rngHistGrade();
    let status: GradeStatus = 'graded';
    let score: number | null = null;
    if (roll < 0.05) status = 'absent';
    else if (roll < 0.08) status = 'excused';
    else {
      status = 'graded';
      const pct = Math.min(1, Math.max(0.4, 0.78 + (rngHistGrade() - 0.5) * 0.4));
      score = Math.round(pct * asmt.max_score);
    }
    assessment_grades.push({
      id: `grd-2024-${histGradeCounter}`,
      assessment_id: asmt.id,
      student_id: stu.id,
      enrollment_id: enrId,
      status,
      score,
      makeup_score: null,
      is_released: true,
    });
  }
}

// Historical attendance — a 2-week weekday window inside Semester 1 of 2024-2025.
const histAttDates: string[] = [];
for (let d = -13; d <= 0; d += 1) {
  const iso = addDays(HIST_ANCHOR, d);
  if (isWeekday(iso)) histAttDates.push(iso);
}
const rngHistAtt = makeRng(99999);
let histAttCounter = 0;
for (const off of histOfferings) {
  const roster = histRoster(off.id);
  for (const date of histAttDates) {
    for (const stu of roster) {
      const enrId = histEnrollmentId.get(`${stu.id}:${off.id}`);
      if (!enrId) continue;
      histAttCounter += 1;
      const roll = rngHistAtt();
      let status: AttendanceStatus;
      if (roll < 0.9) status = 'present';
      else if (roll < 0.95) status = 'absent';
      else if (roll < 0.98) status = 'late';
      else status = 'excused';
      attendance_records.push({
        id: `att-2024-${histAttCounter}`,
        offering_id: off.id,
        student_id: stu.id,
        enrollment_id: enrId,
        semester_id: SEM_2024_1,
        attendance_date: date,
        status,
        recorded_by_user_id: attendanceRecorderUserId,
        recorded_at: `${date}T08:15:00Z`,
      });
    }
  }
}

// ── Assemble + freeze ───────────────────────────────────────────────────────────

// ── Programmes, curriculum and prerequisites (D30 §D3/§D4) ──────────────────────
//
// The real eight BAJC Associate-degree programmes with their full 26/27 sequences —
// 243 curriculum rows and 63 prerequisites — from the generated `bajcCatalog.ts`.
// Nothing here is invented; see the backend twin for the source corrections.
const programs: DemoProgram[] = BAJC_PROGRAMS.map(
  ([code, name, award, totalCredits, minGp]) => ({
    id: `prog-${code.toLowerCase()}`,
    code,
    name,
    award,
    total_credits: totalCredits,
    min_passing_grade_point: minGp,
    is_active: true,
  }),
);
const programId = (code: string): string => `prog-${code.toLowerCase()}`;

const program_courses: DemoProgramCourse[] = BAJC_CURRICULUM.flatMap(
  ([progCode, termLabel, termOrder, codes]) =>
    codes.map((code, i) => ({
      id: `pc-${progCode.toLowerCase()}-${termOrder}-${i}`,
      program_id: programId(progCode),
      course_id: courseId(code),
      term_label: termLabel,
      term_order: termOrder,
      // Every course printed on a sequence counts toward the award; the PDF marks no
      // electives (see the backend catalog's note on the unexplained `*` footnotes).
      is_required: true,
    })),
);

// The real prerequisite relation. `MATH1210 <- MATH1110` is the one the demo actually
// exercises, because PreCalculus-1 and Algebra-1/2/3 are both offered above.
const course_prerequisites: DemoCoursePrerequisite[] = [
  ...BAJC_PREREQUISITES.map(([courseCode, requiredCode], i) => ({
    id: `prereq-${i + 1}`,
    course_id: courseId(courseCode),
    prerequisite_course_id: courseId(requiredCode),
    program_id: null,
    requirement_type: 'course' as const,
  })),
  // `EDUC3201` (Internship) <- literally "ALL COURSES" on the Primary Education
  // sequence. A list of course ids could never say that.
  ...BAJC_ALL_COURSE_GATES.map(([courseCode, progCode], i) => ({
    id: `prereq-all-${i + 1}`,
    course_id: courseId(courseCode),
    prerequisite_course_id: null,
    program_id: programId(progCode),
    requirement_type: 'all_program_courses' as const,
  })),
];


// ── Admissions (D30 §D11) ───────────────────────────────────────────────────────
//
// Four applications, chosen so every state the screens have to render is reachable in
// demo mode without touching anything:
//
//   * a DRAFT, half-transcribed — what the wizard resumes into;
//   * a SUBMITTED one that is complete and ACCEPTABLE — the happy path for the Accept
//     button, including the temporary-password result;
//   * a SUBMITTED one BLOCKED by a pending credit transfer, so the Dean's decision and
//     the "acceptance is blocked" banner are both demonstrable on real data;
//   * an ACCEPTED one already linked to a demo student, so the list's "Student ID" link
//     and the read-only decided view are populated.
//
// A DENIED one is not seeded: denial is one click from the submitted rows and seeding it
// would just occupy a list slot.
const applicationsSeed: DemoApplication[] = [
  {
    id: 'app-draft-1',
    status: 'draft',
    school_year: '2026-2027',
    first_name: 'Marisol',
    middle_name: null,
    last_name: 'Canto',
    date_of_birth: '2007-11-14',
    ssno: null,
    gender: 'female',
    civil_status: null,
    religion: null,
    phone: '+501-6220145',
    email: 'marisol.canto@example.bz',
    has_health_condition: false,
    health_condition_note: null,
    street: '18 Santa Rita Road',
    city_town_village: 'Corozal Town',
    district: 'Corozal',
    mother_name: 'Delmy Canto',
    father_name: null,
    nok_name: 'Delmy Canto',
    nok_relationship: 'Mother',
    nok_phone: '+501-6220146',
    atlib_exam: false,
    num_csec: null,
    finance_name: null,
    finance_phone: null,
    finance_email: null,
    recommendation_received: false,
    // Sections C–G are still blank. That is the point of a draft.
    program_id: null,
    year_of_study: null,
    enrollment_load: null,
    applicant_signed_at: null,
    guardian_signed_at: null,
    date_accepted: null,
    academic_year_id: null,
    enrolment_status: null,
    student_code: null,
    comments: null,
    decided_by_user_id: null,
    decided_at: null,
    student_id: null,
    created_at: '2025-10-02T14:05:00Z',
    updated_at: '2025-10-02T14:22:00Z',
  },
  {
    id: 'app-ready-1',
    status: 'submitted',
    school_year: '2026-2027',
    first_name: 'Presley',
    middle_name: 'A',
    last_name: 'Rancharan',
    date_of_birth: '2006-05-02',
    ssno: '412885031',
    gender: 'male',
    civil_status: 'Single',
    religion: 'Adventist',
    phone: '+501-6311902',
    email: 'presley.rancharan@example.bz',
    has_health_condition: false,
    health_condition_note: null,
    street: '4 Calcutta Village Road',
    city_town_village: 'Calcutta',
    district: 'Corozal',
    mother_name: 'Indira Rancharan',
    father_name: 'Errol Rancharan',
    nok_name: 'Indira Rancharan',
    nok_relationship: 'Mother',
    nok_phone: '+501-6311903',
    atlib_exam: true,
    num_csec: 7,
    finance_name: 'Errol Rancharan',
    finance_phone: '+501-6311904',
    finance_email: 'errol.rancharan@example.bz',
    recommendation_received: true,
    program_id: 'prog-bmad',
    year_of_study: 'First',
    enrollment_load: 'Full Time',
    applicant_signed_at: '2025-09-28',
    guardian_signed_at: null, // an adult — the under-18 rule does not apply
    date_accepted: null,
    academic_year_id: null,
    enrolment_status: null,
    student_code: null,
    comments: null,
    decided_by_user_id: null,
    decided_at: null,
    student_id: null,
    created_at: '2025-09-28T09:10:00Z',
    updated_at: '2025-09-29T11:40:00Z',
  },
  {
    id: 'app-transfer-1',
    status: 'under_review',
    school_year: '2026-2027',
    first_name: 'Kenrick',
    middle_name: null,
    last_name: 'Bevans',
    date_of_birth: '2003-02-19',
    ssno: '399120884',
    gender: 'male',
    civil_status: 'Single',
    religion: null,
    phone: '+501-6704411',
    email: 'kenrick.bevans@example.bz',
    has_health_condition: false,
    health_condition_note: null,
    street: '92 Orange Walk Street',
    city_town_village: 'Orange Walk Town',
    district: 'Orange Walk',
    mother_name: 'Sonia Bevans',
    father_name: null,
    nok_name: 'Sonia Bevans',
    nok_relationship: 'Mother',
    nok_phone: '+501-6704412',
    atlib_exam: false,
    num_csec: 5,
    finance_name: 'Self',
    finance_phone: '+501-6704411',
    finance_email: null,
    recommendation_received: true,
    program_id: 'prog-itec',
    year_of_study: 'Second',
    enrollment_load: 'Part Time',
    applicant_signed_at: '2025-09-20',
    guardian_signed_at: null,
    date_accepted: null,
    academic_year_id: null,
    enrolment_status: null,
    student_code: null,
    comments: 'Transferring from the University of Belize. CTA and transcript received.',
    decided_by_user_id: null,
    decided_at: null,
    student_id: null,
    created_at: '2025-09-20T08:00:00Z',
    updated_at: '2025-10-01T15:30:00Z',
  },
  {
    id: 'app-accepted-1',
    status: 'accepted',
    school_year: '2025-2026',
    first_name: students[0]!.first_name ?? students[0]!.last_name,
    middle_name: students[0]!.middle_name,
    last_name: students[0]!.last_name,
    date_of_birth: students[0]!.date_of_birth,
    ssno: null,
    gender: students[0]!.gender,
    civil_status: null,
    religion: null,
    phone: students[0]!.phone,
    email: `${students[0]!.last_name.toLowerCase()}.applicant@example.bz`,
    has_health_condition: false,
    health_condition_note: null,
    street: null,
    city_town_village: null,
    district: 'Corozal',
    mother_name: null,
    father_name: null,
    nok_name: students[0]!.guardian_name,
    nok_relationship: 'Guardian',
    nok_phone: students[0]!.guardian_phone,
    atlib_exam: true,
    num_csec: 8,
    finance_name: students[0]!.guardian_name,
    finance_phone: students[0]!.guardian_phone,
    finance_email: null,
    recommendation_received: true,
    program_id: students[0]!.program_id,
    year_of_study: 'First',
    enrollment_load: 'Full Time',
    applicant_signed_at: '2025-08-10',
    guardian_signed_at: null,
    date_accepted: '2025-08-18',
    academic_year_id: YEAR_ACTIVE,
    enrolment_status: 'Full Time',
    student_code: students[0]!.student_number,
    comments: 'Accepted for the 2025-2026 intake.',
    decided_by_user_id: principalUserId,
    decided_at: '2025-08-18T16:00:00Z',
    student_id: students[0]!.id,
    created_at: '2025-08-05T10:00:00Z',
    updated_at: '2025-08-18T16:00:00Z',
  },
];

/**
 * D38 — saved-but-unsubmitted forms.
 *
 * **Two rows, filed by two DIFFERENT people, on purpose.** The rule the client asked for is
 * "a Registrar sees only their own; the Dean sees all", and a single row cannot show it: it
 * would look identical whether the scope worked or did not. `temp-2` belongs to a registrar
 * the demo cannot log in as, so signing in as the Registrar and seeing exactly one row —
 * then as the Dean and seeing two — is the rule made visible.
 *
 * `temp-1` is deliberately INCOMPLETE (no programme, no signature), because that is the
 * ordinary case: a form is left pending precisely because something is still missing.
 * `temp-2` is complete, so "Ready to submit" has something to render.
 */
const application_temp: DemoApplicationTemp[] = [
  {
    id: 'temp-1',
    status: 'pending',
    school_year: '2026-2027',
    first_name: 'Delphine',
    middle_name: null,
    last_name: 'Waight',
    date_of_birth: '2008-03-21',
    ssno: null,
    gender: 'female',
    civil_status: null,
    religion: 'Catholic',
    phone: '+501-6701188',
    email: 'delphine.waight@example.bz',
    has_health_condition: false,
    health_condition_note: null,
    street: '4 Mahogany Street',
    city_town_village: 'Belmopan',
    district: 'Cayo',
    mother_name: 'Ivy Waight',
    father_name: null,
    nok_name: 'Ivy Waight',
    nok_relationship: 'Mother',
    nok_phone: '+501-6701189',
    atlib_exam: false,
    num_csec: 6,
    finance_name: null,
    finance_phone: null,
    finance_email: null,
    recommendation_received: false,
    // Missing on purpose — these are what `blocking_issues` will report.
    program_id: null,
    year_of_study: null,
    enrollment_load: null,
    applicant_signed_at: null,
    guardian_signed_at: null,
    academic_year_id: null,
    enrolment_status: null,
    comments: null,
    created_by: 'user-secretary',
    created_by_name: 'Sofia Castillo',
    created_at: '2026-07-30T09:15:00Z',
    updated_at: '2026-08-04T14:40:00Z',
    education: [
      {
        id: 'temp-1-edu-1',
        application_id: 'temp-1',
        institution: 'Belmopan Comprehensive School',
        education_level: 'High School',
        graduated: true,
        graduation_date: '2026-06-26',
        sort_order: 1,
      },
    ],
    documents: [
      {
        id: 'temp-1-doc-1',
        application_id: 'temp-1',
        document_type: 'transcript',
        file_name: null,
        content_type: null,
        size_bytes: null,
        received: true,
      },
    ],
  },
  {
    id: 'temp-2',
    status: 'pending',
    school_year: '2026-2027',
    first_name: 'Rolando',
    middle_name: 'A',
    last_name: 'Zetina',
    date_of_birth: '2005-01-09',
    ssno: null,
    gender: 'male',
    civil_status: 'Single',
    religion: null,
    phone: '+501-6335512',
    email: 'rolando.zetina@example.bz',
    has_health_condition: false,
    health_condition_note: null,
    street: '77 Front Street',
    city_town_village: 'Dangriga',
    district: 'Stann Creek',
    mother_name: null,
    father_name: 'Neri Zetina',
    nok_name: 'Neri Zetina',
    nok_relationship: 'Father',
    nok_phone: '+501-6335513',
    atlib_exam: true,
    num_csec: 8,
    finance_name: 'Neri Zetina',
    finance_phone: '+501-6335513',
    finance_email: null,
    recommendation_received: true,
    program_id: programs[0]!.id,
    year_of_study: 'First',
    enrollment_load: 'Full Time',
    applicant_signed_at: '2026-08-10',
    guardian_signed_at: null,
    academic_year_id: null,
    enrolment_status: null,
    comments: null,
    // A Registrar the demo has no login for, so the scope rule is observable.
    created_by: 'user-registrar-2',
    created_by_name: 'Karen Requena',
    created_at: '2026-08-11T08:05:00Z',
    updated_at: '2026-08-11T08:52:00Z',
    education: [
      {
        id: 'temp-2-edu-1',
        application_id: 'temp-2',
        institution: 'Ecumenical High School',
        education_level: 'High School',
        graduated: true,
        graduation_date: '2023-06-30',
        sort_order: 1,
      },
    ],
    documents: [],
  },
];

const application_education: DemoApplicationEducation[] = [
  {
    id: 'appedu-1',
    application_id: 'app-draft-1',
    institution: 'Corozal Community College',
    education_level: 'High School',
    graduated: true,
    graduation_date: '2025-06-27',
    sort_order: 1,
  },
  {
    id: 'appedu-2',
    application_id: 'app-ready-1',
    institution: 'Corozal Community College',
    education_level: 'High School',
    graduated: true,
    graduation_date: '2024-06-28',
    sort_order: 1,
  },
  {
    id: 'appedu-3',
    application_id: 'app-transfer-1',
    institution: 'Escuela Secundaria Técnica México',
    education_level: 'High School',
    graduated: true,
    graduation_date: '2021-07-02',
    sort_order: 1,
  },
  {
    // The TERTIARY row is what makes the credit transfer approvable at all: policy allows
    // transfer only from a recognised tertiary institution, and the server checks Section B
    // for one before it lets the Dean approve.
    id: 'appedu-4',
    application_id: 'app-transfer-1',
    institution: 'University of Belize',
    education_level: 'Tertiary',
    graduated: false,
    graduation_date: null,
    sort_order: 2,
  },
];

const application_documents: DemoApplicationDocument[] = [
  { id: 'appdoc-1', application_id: 'app-draft-1', document_type: 'passport_photo', file_name: null, content_type: null, size_bytes: null, received: true },
  { id: 'appdoc-2', application_id: 'app-ready-1', document_type: 'passport_photo', file_name: null, content_type: null, size_bytes: null, received: true },
  { id: 'appdoc-3', application_id: 'app-ready-1', document_type: 'hs_diploma', file_name: null, content_type: null, size_bytes: null, received: true },
  { id: 'appdoc-4', application_id: 'app-ready-1', document_type: 'recommendation_form', file_name: null, content_type: null, size_bytes: null, received: true },
  { id: 'appdoc-5', application_id: 'app-ready-1', document_type: 'social_security_card', file_name: null, content_type: null, size_bytes: null, received: false },
  { id: 'appdoc-6', application_id: 'app-transfer-1', document_type: 'passport_photo', file_name: null, content_type: null, size_bytes: null, received: true },
  { id: 'appdoc-7', application_id: 'app-transfer-1', document_type: 'cta', file_name: 'cta-bevans.pdf', content_type: 'application/pdf', size_bytes: 184320, received: true },
  { id: 'appdoc-8', application_id: 'app-transfer-1', document_type: 'transcript', file_name: 'ub-transcript.pdf', content_type: 'application/pdf', size_bytes: 262144, received: true },
  { id: 'appdoc-9', application_id: 'app-transfer-1', document_type: 'course_outline', file_name: 'ub-outlines.pdf', content_type: 'application/pdf', size_bytes: 331776, received: true },
];

// One PENDING request, so the Dean's approve/deny controls and the "acceptance is blocked
// while a transfer is undecided" rule are both demonstrable. Equivalency is deliberately
// left UNASSESSED: filing states a claim, and assessing it is the Dean's job — so the
// Approve button starts disabled with the ≥75% rule in its tooltip.
const credit_transfer_requests: DemoCreditTransferRequest[] = [
  {
    id: 'cta-1',
    application_id: 'app-transfer-1',
    external_institution: 'University of Belize',
    external_course_code: 'CMPS1011',
    external_course_name: 'Introduction to Programming',
    external_credits: 3,
    external_grade: 'B+',
    target_course_id: courseId('ITEC1104'),
    content_equivalency_pct: null,
    cta_document_id: 'appdoc-7',
    transcript_document_id: 'appdoc-8',
    outline_document_id: 'appdoc-9',
    status: 'pending',
    decided_by_user_id: null,
    decided_at: null,
    note: null,
    created_at: '2025-10-01T15:30:00Z',
  },
];

// Every student's programme history opens on the day they enrolled — the same thing
// acceptance does, so the academic-history panel is populated for all of them rather than
// only for the one with a seeded application (§D12).
const student_program_history: DemoStudentProgramHistory[] = students
  .filter((student) => student.program_id !== null)
  .map((student, index) => ({
    id: `sph-${index + 1}`,
    student_id: student.id,
    program_id: student.program_id!,
    started_at: student.enrollment_date,
    ended_at: null,
    reason: 'Admitted',
  }));


// ── Grade revision (D30 §D7) ────────────────────────────────────────────────────
//
// ONE pending request, so both halves of the workflow are demonstrable without touching
// anything: the Dean's queue has a row to rule on and the bell badge has something to
// count, while the Lecturer sees their own request with its status.
//
// Filed against the first GRADED, RELEASED result belonging to the demo Lecturer's own
// offerings — anything else would be refused by the same rules the real backend applies
// (the grade must exist and be `graded`, and the Lecturer must own the offering), so
// picking it by search rather than by hand keeps the seed honest as the dataset changes.
const revisableGrade = (() => {
  const teacherId = teachers.find((t) => t.user_id === 'user-teach-1')?.id ?? teachers[0]?.id;
  const owned = new Set(
    offerings.filter((o) => o.teacher_ids.includes(teacherId!)).map((o) => o.id),
  );
  const ownedAssessments = new Set(
    assessments.filter((a) => owned.has(a.offering_id) && a.status === 'graded').map((a) => a.id),
  );
  return assessment_grades.find(
    (g) => ownedAssessments.has(g.assessment_id) && g.status === 'graded' && g.score != null,
  );
})();

const grade_revision_requests: DemoGradeRevisionRequest[] = revisableGrade
  ? [
      {
        id: 'rev-seed-1',
        assessment_grade_id: revisableGrade.id,
        requested_by_user_id: 'user-teach-1',
        reason:
          'The second essay question was marked out of 10 but is worth 20. Re-marked, the student gains 8.',
        original_score: revisableGrade.score,
        // Capped at the assessment's ceiling, so the seed can never be an invalid request.
        proposed_score: Math.min(
          (revisableGrade.score ?? 0) + 8,
          assessments.find((a) => a.id === revisableGrade.assessment_id)?.max_score ?? 100,
        ),
        status: 'pending',
        decided_by_user_id: null,
        decided_at: null,
        decision_note: null,
        created_at: '2025-10-14T10:30:00Z',
      },
    ]
  : [];

// ── D35: a few non-ordinary course statuses ─────────────────────────────────────
//
// The client's `coursestatus` is worth nothing in a demo where every row says `enrolled`,
// so a handful are marked. Deliberately SPARSE and deliberately not on the two scenario
// students (`stu-1` Freddy, `stu-2` John): their timetables, gradebooks and report cards
// are what the demo walks through, and an audit or a withdrawal changes their GPA.
//
// Picked from the ACTIVE term only, so the roster the demo opens is the one that shows
// them.
(() => {
  const active = enrollments.filter(
    (e) => e.semester_id === SEM_ACTIVE && !e.unenrolled_at && e.student_id !== 'stu-1' && e.student_id !== 'stu-2',
  );
  const mark = (index: number, status: DemoEnrollment['enrollment_status']) => {
    const row = active[index];
    if (row) row.enrollment_status = status;
  };
  // One of each, so every branch of the roster badge, the academic-history bucket and the
  // transcript notation has a row behind it.
  mark(3, 'audit');
  mark(11, 'withdraw_passing');
  mark(19, 'withdraw_failing');
  mark(27, 'audit');
})();

export const DEMO_DATASET: DemoDataset = {
  school_profile,
  religions,
  academic_years,
  semesters,
  courses,
  programs,
  program_courses,
  course_prerequisites,
  offerings,
  teachers,
  students,
  offering_meetings,
  enrollments,
  assessment_categories,
  assessments,
  assessment_grades,
  attendance_records,
  announcements,
  events,
  grading_scales,
  assessment_policy,
  users,
  applications: applicationsSeed,
  application_temp,
  application_education,
  application_documents,
  credit_transfer_requests,
  student_program_history,
  grade_revision_requests,
};

// Convenience exported id constants module agents may reference in tests/handlers.
export const DEMO_IDS = {
  activeYearId: YEAR_ACTIVE,
  archivedYearId: YEAR_ARCHIVED,
  activeSemesterId: SEM_ACTIVE,
  principalUserId,
} as const;
