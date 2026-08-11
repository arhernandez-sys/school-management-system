/**
 * DEMO DATASET — the single in-memory fake dataset (frontend-only client demo).
 *
 * A realistic Belize **sixth form** (D29). EVERYTHING reconciles: dashboards, lists,
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
 * D29 — WHY THIS DATASET IS SHAPED THE WAY IT IS
 * ────────────────────────────────────────────────────────────────────────────────
 * This used to be 8 homerooms ("Form 1A") each teaching 7 subjects, with every student
 * enrolled in exactly one. A sixth form works like a university: the office creates
 * SUBJECT CLASSES ("Math-1", "Math-2") and enrols each student into the ones they take.
 *
 * The dataset therefore hard-codes the scenario that PROVES the model, rather than
 * generating one:
 *
 *     Freddy Lopez (stu-1)  →  Math-1 · Biology-10 · English-5 · Chemistry-3
 *     John Garcia  (stu-2)  →  Math-2 · Biology-10 · English-5 · IT-2
 *
 * They share Biology and English but sit in DIFFERENT Math classes, so their timetables
 * differ in exactly one slot. A homeroom model cannot express that at all — which is the
 * point. `stu-1` is the seeded `student` login (DEMO_REPRESENTATIVE_USER_ID), so signing
 * in as the demo student lands on Freddy.
 */
import type {
  DemoAcademicYear,
  DemoAnnouncement,
  DemoAssessment,
  DemoAssessmentCategory,
  DemoAssessmentGrade,
  DemoAssessmentPolicy,
  DemoAttendanceRecord,
  DemoClassMeeting,
  DemoClassSubject,
  DemoEvent,
  DemoDataset,
  DemoEnrollment,
  DemoGradingScale,
  DemoSchoolProfile,
  DemoSection,
  DemoSemester,
  DemoStudent,
  DemoSubject,
  DemoTeacher,
  DemoUser,
} from './types';
import type { AttendanceStatus, GradeStatus } from '@shared/types/enums';

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
    sequence: 1,
    start_date: '2024-09-02',
    end_date: '2025-01-17',
    is_active: false,
  },
  {
    id: 'sem-2024-2',
    academic_year_id: YEAR_ARCHIVED,
    name: 'Semester 2',
    sequence: 2,
    start_date: '2025-01-20',
    end_date: '2025-06-27',
    is_active: false,
  },
  {
    id: SEM_ACTIVE,
    academic_year_id: YEAR_ACTIVE,
    name: 'Semester 1',
    sequence: 1,
    start_date: '2025-09-01',
    end_date: '2026-01-16',
    is_active: true,
  },
  {
    id: 'sem-2025-2',
    academic_year_id: YEAR_ACTIVE,
    name: 'Semester 2',
    sequence: 2,
    start_date: '2026-01-19',
    end_date: '2026-06-26',
    is_active: false,
  },
];

// ── Subjects (~11) ──────────────────────────────────────────────────────────────
const subjectSeed: ReadonlyArray<[string, string]> = [
  ['Mathematics', 'MATH'],
  ['English', 'ENG'],
  ['Biology', 'BIO'],
  ['Chemistry', 'CHEM'],
  ['Physics', 'PHYS'],
  ['History', 'HIST'],
  ['Geography', 'GEO'],
  ['Spanish', 'SPAN'],
  ['Physical Education', 'PE'],
  ['Information Technology', 'IT'],
  ['Principles of Business', 'POB'],
];
const subjects: DemoSubject[] = subjectSeed.map(([name, code]) => ({
  id: `subj-${code.toLowerCase()}`,
  name,
  code,
  is_active: true,
}));
const subjectId = (code: string): string => `subj-${code.toLowerCase()}`;

// ── Subject classes (D29) ───────────────────────────────────────────────────────
//
// Each row is one class: a subject, the teacher who leads it, a room, a capacity, and the
// weekly slots it meets in. Two parallel Math classes at Lower 6 are the whole reason this
// dataset exists — they are what lets Freddy and John differ.
//
// Meetings are written as [ISO weekday, start, end]; rooms come from the class, since a
// subject class in this school always meets in the same place.
const YEAR_LOWER6 = 'Lower 6';
const YEAR_UPPER6 = 'Upper 6';

interface ClassSeed {
  name: string;
  /** Subject catalog code (see `subjectSeed`). */
  code: string;
  yearGroup: string;
  /** Teacher codes; the first is the lead. Defaults to the subject's usual teacher. */
  teacherCodes?: string[];
  room: string;
  capacity: number;
  meetings: ReadonlyArray<[1 | 2 | 3 | 4 | 5, string, string]>;
}

const classSeed: readonly ClassSeed[] = [
  // ── Lower 6 ──
  { name: 'Math-1', code: 'MATH', yearGroup: YEAR_LOWER6, room: 'Room A', capacity: 20,
    meetings: [[1, '08:00', '09:30'], [3, '08:00', '09:30']] },
  // Math-2 is Math-1's parallel: same subject, same level, different teacher/room/time.
  { name: 'Math-2', code: 'MATH', yearGroup: YEAR_LOWER6, teacherCodes: ['PHYS'], room: 'Room C', capacity: 20,
    meetings: [[1, '10:00', '11:30'], [3, '10:00', '11:30']] },
  { name: 'Biology-10', code: 'BIO', yearGroup: YEAR_LOWER6, room: 'Lab 1', capacity: 24,
    meetings: [[2, '09:00', '10:30'], [4, '09:00', '10:30']] },
  // Wednesday sits at 13:00, NOT 11:00: Math-2 runs Wed 10:00–11:30, and every student on
  // a Math-2 load also takes English, so an 11:00 English would put 15 of them in two rooms
  // at once. The seeded week must be one a real student could actually walk.
  { name: 'English-5', code: 'ENG', yearGroup: YEAR_LOWER6, room: 'Room D', capacity: 26,
    meetings: [[3, '13:00', '14:00'], [5, '11:00', '12:00']] },
  { name: 'Chemistry-3', code: 'CHEM', yearGroup: YEAR_LOWER6, room: 'Lab 2', capacity: 18,
    meetings: [[2, '11:00', '12:30']] },
  { name: 'IT-2', code: 'IT', yearGroup: YEAR_LOWER6, room: 'Computer Lab', capacity: 22,
    meetings: [[5, '08:00', '09:30']] },
  // ── Upper 6 ──
  { name: 'Math-3', code: 'MATH', yearGroup: YEAR_UPPER6, room: 'Room A', capacity: 18,
    meetings: [[2, '08:00', '09:30'], [4, '11:00', '12:30']] },
  { name: 'Physics-1', code: 'PHYS', yearGroup: YEAR_UPPER6, room: 'Lab 2', capacity: 16,
    meetings: [[1, '13:00', '14:30']] },
  { name: 'Business-1', code: 'POB', yearGroup: YEAR_UPPER6, room: 'Room B', capacity: 20,
    meetings: [[4, '13:00', '14:30']] },
  { name: 'Spanish-2', code: 'SPAN', yearGroup: YEAR_UPPER6, room: 'Room E', capacity: 20,
    meetings: [[5, '13:00', '14:00']] },
];

const sections: DemoSection[] = classSeed.map((c, i) => ({
  id: `sec-${i + 1}`,
  academic_year_id: YEAR_ACTIVE,
  name: c.name,
  grade_level: c.yearGroup,
  // A sixth-form subject class has no division letter, and no homeroom label — both
  // belonged to the retired model.
  section: null,
  homeroom_label: null,
  capacity: c.capacity,
  is_archived: false,
}));
const sectionByName = (name: string): DemoSection => {
  const found = sections.find((s) => s.name === name);
  if (!found) throw new Error(`demo dataset: no subject class named ${name}`);
  return found;
};

// ── Teachers (~12, Belizean names) ──────────────────────────────────────────────
type TeacherLike = 'active' | 'inactive';
type TeacherGender = 'male' | 'female';
const teacherSeed: ReadonlyArray<[string, string[], TeacherLike, TeacherGender]> = [
  ['Maria Reyes', ['MATH', 'PHYS'], 'active', 'female'],
  ['Carlos Mendez', ['ENG', 'HIST'], 'active', 'male'],
  ['Alicia Cano', ['BIO', 'CHEM'], 'active', 'female'],
  ['Devon Flowers', ['PHYS', 'MATH'], 'active', 'male'],
  ['Sonia Choc', ['SPAN', 'ENG'], 'active', 'female'],
  ['Rodwell Bailey', ['GEO', 'HIST'], 'active', 'male'],
  ['Yolanda Cruz', ['CHEM', 'BIO'], 'active', 'female'],
  ['Egbert Grinage', ['PE'], 'active', 'male'],
  ['Nadia Rhaburn', ['IT'], 'active', 'female'],
  ['Marlon Pou', ['POB', 'MATH'], 'active', 'male'],
  ['Kayla Waight', ['ENG', 'IT'], 'active', 'female'],
  ['Trevor Neal', ['GEO', 'PE'], 'inactive', 'male'],
];
// Deterministic academic profile extras, rotated so the directory shows a believable mix.
const TEACHER_DESIGNATIONS = ['Head of Department', 'Senior Teacher', 'Senior Teacher', 'Teacher'] as const;
const TEACHER_DEGREES: Record<(typeof TEACHER_DESIGNATIONS)[number], string> = {
  'Head of Department': 'M.Ed.',
  'Senior Teacher': 'M.Sc.',
  Teacher: 'B.Ed.',
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
  const specNames = specs.map((c) => subjectSeed.find(([, code]) => code === c)![0]);
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
    education: `${TEACHER_DEGREES[designation]} ${specNames[0]}`,
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
  const name = subjectSeed.find(([, c]) => c === code)![0];
  return teachers.find((t) => t.status === 'active' && t.subject_specializations.includes(name))!;
};

// ── class_subjects: EXACTLY ONE per subject class (D29) ─────────────────────────
//
// The join table survives (every assessment, grade and teacher assignment keys off
// `class_subject_id`), but it is now 1:1 with the class rather than 1:many. `cs-N` lines up
// with `sec-N`, which keeps the fixtures readable.
const class_subjects: DemoClassSubject[] = classSeed.map((c, i) => {
  const leadCode = c.teacherCodes?.[0] ?? c.code;
  const lead = teacherByCode(leadCode);
  const extra = (c.teacherCodes ?? []).slice(1).map((code) => teacherByCode(code).id);
  // One co-taught class (Math-1) so the "many teachers per class" path (D16) is exercised.
  const coTeacher = c.name === 'Math-1' ? teachers.find((t) => t.id === 'teach-4') : undefined;
  const teacher_ids = [
    lead.id,
    ...extra,
    ...(coTeacher && coTeacher.id !== lead.id ? [coTeacher.id] : []),
  ];
  return {
    id: `cs-${i + 1}`,
    section_id: `sec-${i + 1}`,
    subject_id: subjectId(c.code),
    teacher_ids: [...new Set(teacher_ids)],
    lead_teacher_id: lead.id,
    is_active: true,
    drop_lowest_count: c.code === 'MATH' ? 1 : 0,
  };
});
// ── class_meetings: the weekly slot(s) each subject class occupies ──────────────
const class_meetings: DemoClassMeeting[] = [];
let meetingCounter = 0;
classSeed.forEach((c, i) => {
  for (const [day, start, end] of c.meetings) {
    meetingCounter += 1;
    class_meetings.push({
      id: `mtg-${meetingCounter}`,
      class_subject_id: `cs-${i + 1}`,
      day_of_week: day,
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      room: c.room,
    });
  }
});

// ── Students (~45, Belizean names), each enrolled in ONE section ────────────────
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
 * The subject load each student takes, by year group. A sixth-former picks a handful of
 * subjects rather than receiving a fixed set, so the generator rotates students through
 * these combinations — including the two parallel Math classes, which is what makes any
 * two students' timetables genuinely different.
 */
const LOWER6_LOADS: ReadonlyArray<readonly string[]> = [
  ['Math-1', 'Biology-10', 'English-5', 'Chemistry-3'],
  ['Math-2', 'Biology-10', 'English-5', 'IT-2'],
  ['Math-1', 'Biology-10', 'English-5', 'IT-2'],
  ['Math-2', 'Chemistry-3', 'English-5', 'IT-2'],
];
const UPPER6_LOADS: ReadonlyArray<readonly string[]> = [
  ['Math-3', 'Physics-1', 'Spanish-2'],
  ['Business-1', 'Spanish-2', 'Math-3'],
  ['Math-3', 'Physics-1', 'Business-1'],
];

/**
 * The two named students the whole D29 demo turns on. Hard-coded rather than generated so
 * the scenario cannot drift: same Biology, same English, DIFFERENT Math.
 * `stu-1` is the seeded student login, so the demo lands on Freddy.
 */
const SCENARIO: Record<string, { name: string; yearGroup: string; classes: readonly string[] }> = {
  'stu-1': {
    name: 'Freddy Lopez',
    yearGroup: YEAR_LOWER6,
    classes: ['Math-1', 'Biology-10', 'English-5', 'Chemistry-3'],
  },
  'stu-2': {
    name: 'John Garcia',
    yearGroup: YEAR_LOWER6,
    classes: ['Math-2', 'Biology-10', 'English-5', 'IT-2'],
  },
};

const students: DemoStudent[] = [];
const rngStu = makeRng(4242);
/** studentId → the class names they take. Built alongside students, consumed by enrollments. */
const loadByStudent = new Map<string, readonly string[]>();

for (let i = 0; i < 45; i += 1) {
  const id = `stu-${i + 1}`;
  const scenario = SCENARIO[id];
  // Roughly two-thirds Lower 6 (the larger intake), the rest Upper 6.
  const yearGroup = scenario?.yearGroup ?? (i % 3 === 2 ? YEAR_UPPER6 : YEAR_LOWER6);
  const first = FIRST_NAMES[i]!;
  const last = pick(rngStu, LAST_NAMES);
  // Sixth-formers are ~16-18: Lower 6 born ~2008, Upper 6 ~2007.
  const birthYear = yearGroup === YEAR_UPPER6 ? 2007 : 2008;
  const dob = `${birthYear}-${String(randInt(rngStu, 1, 12)).padStart(2, '0')}-${String(
    randInt(rngStu, 1, 28),
  ).padStart(2, '0')}`;
  // Mostly active; a few inactive/graduated/withdrawn for realism. The two scenario
  // students are always active — the demo depends on their timetables rendering.
  let status: DemoStudent['status'] = 'active';
  if (!scenario) {
    if (i === 7) status = 'inactive';
    else if (i === 20) status = 'withdrawn';
    else if (i === 33) status = 'transferred';
    else if (i === 41) status = 'graduated';
  }
  const full_name = scenario?.name ?? `${first} ${last}`;

  // Graduated / withdrawn students hold no active enrollment.
  const load =
    status === 'graduated' || status === 'withdrawn'
      ? []
      : (scenario?.classes ??
        (yearGroup === YEAR_UPPER6
          ? UPPER6_LOADS[i % UPPER6_LOADS.length]!
          : LOWER6_LOADS[i % LOWER6_LOADS.length]!));
  loadByStudent.set(id, load);

  students.push({
    id,
    user_id: i < 6 ? `user-stu-${i + 1}` : null, // first few have logins (demo student login)
    student_number: `S-${String(25001 + i)}`,
    full_name,
    date_of_birth: dob,
    gender: i % 2 === 0 ? 'female' : 'male',
    enrollment_date: '2025-09-01',
    status,
    year_group: yearGroup,
    guardian_name: `${pick(rngStu, FIRST_NAMES)} ${last}`,
    guardian_phone: `+501-6${randInt(rngStu, 100000, 999999)}`,
    guardian_email: `${last.toLowerCase()}.guardian@example.bz`,
    address: `${randInt(rngStu, 1, 99)} ${pick(rngStu, ['Cedar', 'Mahogany', 'Bougainvillea', 'Hibiscus'])} Street, Belmopan`,
    phone: `+501-6${randInt(rngStu, 100000, 999999)}`,
  });
}

// ── Enrollments: MANY per student (D29) — one row per subject class they take ───
const enrollments: DemoEnrollment[] = [];
let enrollCounter = 0;
for (const stu of students) {
  for (const className of loadByStudent.get(stu.id) ?? []) {
    enrollCounter += 1;
    enrollments.push({
      id: `enr-${enrollCounter}`,
      student_id: stu.id,
      section_id: sectionByName(className).id,
      semester_id: SEM_ACTIVE,
      enrolled_at: '2025-09-01T08:00:00Z',
      unenrolled_at: null,
    });
  }
}
// One student switched Math classes mid-term: a closed row on Math-1 plus an active row on
// Math-2. Under D29 this is a genuine SWITCH of one subject class, not the old whole-student
// "transfer" — and it still exercises the "grade rows ∪ active roster" path in Module 3.
const switchStudent = students.find((s) => s.status === 'transferred');
if (switchStudent) {
  enrollCounter += 1;
  enrollments.push({
    id: `enr-${enrollCounter}`,
    student_id: switchStudent.id,
    section_id: sectionByName('Math-1').id,
    semester_id: SEM_ACTIVE,
    enrolled_at: '2025-09-01T08:00:00Z',
    unenrolled_at: '2025-09-25T08:00:00Z',
  });
}

function activeRoster(sectionId: string): DemoStudent[] {
  const enrolledIds = enrollments
    .filter((e) => e.section_id === sectionId && e.semester_id === SEM_ACTIVE && !e.unenrolled_at)
    .map((e) => e.student_id);
  return students.filter((s) => enrolledIds.includes(s.id));
}
function activeEnrollment(studentId: string, sectionId: string): DemoEnrollment | undefined {
  return enrollments.find(
    (e) =>
      e.student_id === studentId &&
      e.section_id === sectionId &&
      e.semester_id === SEM_ACTIVE &&
      !e.unenrolled_at,
  );
}

// ── Assessment categories: Quizzes + Tests on every class_subject ───────────────
const assessment_categories: DemoAssessmentCategory[] = [];
for (const cs of class_subjects) {
  assessment_categories.push(
    { id: `cat-${cs.id}-q`, class_subject_id: cs.id, name: 'Quizzes', weight: 0.4, drop_lowest_count: 1 },
    { id: `cat-${cs.id}-t`, class_subject_id: cs.id, name: 'Tests', weight: 0.6, drop_lowest_count: 0 },
  );
}

// ── Assessments: a few per class_subject (quiz/test/project mix) ────────────────
//
// `semester` on each template is what makes the student's year·SEMESTER switcher
// demonstrable. Every active-year assessment used to be seeded into `SEM_ACTIVE`
// (Semester 1), so switching to "2025-2026 · Semester 2" filtered correctly and showed
// an empty table — indistinguishable from the filter being broken. The two Semester 2
// rows below sit inside `sem-2025-2`'s real window (2026-01-19 → 2026-06-26), which is
// after DEMO_TODAY, so they are `published`/unreleased: an upcoming term, which is both
// realistic and exactly what a student would expect to see there.
const assessments: DemoAssessment[] = [];
let asmtCounter = 0;
const ASMT_TEMPLATES: ReadonlyArray<{
  title: string;
  type: DemoAssessment['type'];
  catSuffix: 'q' | 't' | null;
  max: number;
  weight: number;
  /** Days from DEMO_TODAY for a Semester 1 row; ignored when `date` is given. */
  offsetDays: number;
  /** Absolute date for a row that must land inside a specific semester's window. */
  date?: string;
  semester: string;
  status: DemoAssessment['status'];
  released: boolean;
}> = [
  { title: 'Quiz 1', type: 'quiz', catSuffix: 'q', max: 20, weight: 1, offsetDays: -30, semester: SEM_ACTIVE, status: 'graded', released: true },
  { title: 'Quiz 2', type: 'quiz', catSuffix: 'q', max: 20, weight: 1, offsetDays: -16, semester: SEM_ACTIVE, status: 'graded', released: true },
  { title: 'Unit Test 1', type: 'test', catSuffix: 't', max: 50, weight: 1, offsetDays: -9, semester: SEM_ACTIVE, status: 'graded', released: false },
  { title: 'Project', type: 'assignment', catSuffix: null, max: 100, weight: 1, offsetDays: 7, semester: SEM_ACTIVE, status: 'published', released: false },
  // ── Semester 2 of the active year ──
  { title: 'Quiz 3', type: 'quiz', catSuffix: 'q', max: 20, weight: 1, offsetDays: 0, date: '2026-02-10', semester: SEM_2025_2, status: 'published', released: false },
  { title: 'Midterm Exam', type: 'exam', catSuffix: 't', max: 100, weight: 2, offsetDays: 0, date: '2026-03-18', semester: SEM_2025_2, status: 'published', released: false },
];
for (const cs of class_subjects) {
  if (!cs.is_active) continue;
  for (const tmpl of ASMT_TEMPLATES) {
    asmtCounter += 1;
    assessments.push({
      id: `asmt-${asmtCounter}`,
      class_subject_id: cs.id,
      semester_id: tmpl.semester,
      category_id: tmpl.catSuffix ? `cat-${cs.id}-${tmpl.catSuffix}` : null,
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
  const cs = class_subjects.find((c) => c.id === asmt.class_subject_id)!;
  const roster = activeRoster(cs.section_id);
  for (const stu of roster) {
    const enr = activeEnrollment(stu.id, cs.section_id);
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
        // Centered around ~75% with spread; clamp to [0, max].
        const pct = Math.min(1, Math.max(0.35, 0.75 + (rngGrade() - 0.5) * 0.5));
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

// ── Attendance: recent ~2 weeks of daily per-section records ────────────────────
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
for (const sec of sections) {
  const roster = activeRoster(sec.id);
  for (const date of attDates) {
    for (const stu of roster) {
      const enr = activeEnrollment(stu.id, sec.id);
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
        section_id: sec.id,
        student_id: stu.id,
        enrollment_id: enr.id,
        semester_id: SEM_ACTIVE,
        attendance_date: date,
        status,
        recorded_by_user_id: teacherByCode('MATH').user_id ?? principalUserId,
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
    section_id: null,
    author_user_id: principalUserId,
    published_at: addDays(DEMO_TODAY, -20) + 'T08:00:00Z',
    expires_at: null,
    read_by_user_ids: ['user-teach-1', 'user-stu-1'],
  },
  {
    id: 'ann-2',
    title: 'Staff meeting — Thursday 3:30 PM',
    body: 'All teaching staff should attend the term-planning meeting in the staff room. Department heads, please bring your assessment calendars.',
    audience: 'teachers',
    section_id: null,
    author_user_id: principalUserId,
    published_at: addDays(DEMO_TODAY, -6) + 'T14:00:00Z',
    expires_at: addDays(DEMO_TODAY, 2) + 'T00:00:00Z',
    read_by_user_ids: ['user-teach-1'],
  },
  {
    id: 'ann-3',
    title: 'Midterm exam schedule released',
    body: 'The midterm timetable is now available. Review your subjects and prepare accordingly. Speak to your teachers about any clashes.',
    audience: 'students',
    section_id: null,
    author_user_id: 'user-secretary',
    published_at: addDays(DEMO_TODAY, -4) + 'T10:00:00Z',
    expires_at: null,
    read_by_user_ids: [],
  },
  {
    id: 'ann-4',
    title: 'Form 1A — bring lab coats Friday',
    body: 'For our first Biology practical this Friday, all Form 1A students must bring a lab coat and closed-toe shoes.',
    audience: 'class',
    section_id: 'sec-1',
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
    section_id: null,
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
    section_id: null,
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
    title: 'Term Planning — Staff Meeting',
    description: 'All teaching staff meet to review the mid-term timetable and assessment calendar.',
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
    title: 'Midterm Examinations',
    description: 'Midterm exams across all forms. Refer to the posted timetable for your subjects.',
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
    title: 'First-Term Report Cards Issued',
    description: 'Report cards for the first term are released to students and guardians.',
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

// ── Grading scale + bands (per active year; .99 ceilings tolerated, OQ-DB2) ─────
const activeBands: DemoGradingScale['bands'] = [
  { letter: 'A', min_score: 90, max_score: 100, is_passing: true, sort_order: 1 },
  { letter: 'B', min_score: 80, max_score: 89.99, is_passing: true, sort_order: 2 },
  { letter: 'C', min_score: 70, max_score: 79.99, is_passing: true, sort_order: 3 },
  { letter: 'D', min_score: 60, max_score: 69.99, is_passing: true, sort_order: 4 },
  { letter: 'F', min_score: 0, max_score: 59.99, is_passing: false, sort_order: 5 },
];
const grading_scales: DemoGradingScale[] = [
  { academic_year_id: YEAR_ACTIVE, pass_mark: 60, is_frozen: false, bands: activeBands },
  {
    academic_year_id: YEAR_ARCHIVED,
    pass_mark: 60,
    is_frozen: true,
    bands: activeBands.map((b) => ({ ...b })),
  },
];

const assessment_policy: DemoAssessmentPolicy = {
  absent_as_zero: true,
  allow_makeup: true,
  drop_lowest_count: 0,
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
    is_active: s.status === 'active',
    must_change_password: false,
    last_login_at: addDays(DEMO_TODAY, -randInt(makeRng(s.id.length + 9), 0, 7)) + 'T15:00:00Z',
  });
}

// ── Historical year (2024-2025) — a full parallel dataset ───────────────────────
// So the per-module year switcher shows populated, DISTINCT data when a past year
// is selected. Same students/teachers/subjects (those entities persist across
// years); separate sections, offerings, enrollments, assessments, grades and
// attendance, all tagged to the archived year's Semester 1 (`sem-2024-1`).
const HIST_ANCHOR = '2025-01-10'; // a weekday inside Semester 1 of 2024-2025
const SEM_2024_1 = 'sem-2024-1';

// Historical subject classes mirror the active structure but belong to the archived year.
// They carry is_archived=true and their offerings is_active=false so that EVERY
// existing "active year" filter (`!is_archived`, `is_active`) keeps excluding them
// by default — current screens are unchanged. The per-module year switcher selects
// them explicitly by academic_year_id when a past year is chosen.
//
// D29: last year's classes are last year's SUBJECT CLASSES — same names, so a student's
// past-year record reads as "the Math-1 I sat last year". They get no `class_meetings`:
// a timetable is about where to be now, and reconstructing an archived week would imply
// the schedule is historical data, which it is not.
const histSections: DemoSection[] = classSeed.map((c, i) => ({
  id: `sec-2024-${i + 1}`,
  academic_year_id: YEAR_ARCHIVED,
  name: c.name,
  grade_level: c.yearGroup,
  section: null,
  homeroom_label: null,
  capacity: c.capacity,
  is_archived: true,
}));
sections.push(...histSections);

// Historical class_subjects: same subject + lead teacher as the active year's twin.
const histClassSubjects: DemoClassSubject[] = classSeed.map((c, i) => {
  const lead = teacherByCode(c.teacherCodes?.[0] ?? c.code);
  return {
    id: `cs-2024-${i + 1}`,
    section_id: `sec-2024-${i + 1}`,
    subject_id: subjectId(c.code),
    teacher_ids: [lead.id],
    lead_teacher_id: lead.id,
    is_active: false,
    drop_lowest_count: c.code === 'MATH' ? 1 : 0,
  };
});
// Give the (now-inactive) teacher Trevor Neal a historical Geography assignment so
// the Teachers directory scoped to 2024-2025 shows a believable past-year roster.
const histGeo = histClassSubjects.find((c) => c.subject_id === subjectId('GEO'));
if (histGeo && !histGeo.teacher_ids.includes('teach-12')) histGeo.teacher_ids.push('teach-12');
class_subjects.push(...histClassSubjects);

for (const cs of histClassSubjects) {
  assessment_categories.push(
    { id: `cat-${cs.id}-q`, class_subject_id: cs.id, name: 'Quizzes', weight: 0.4, drop_lowest_count: 1 },
    { id: `cat-${cs.id}-t`, class_subject_id: cs.id, name: 'Tests', weight: 0.6, drop_lowest_count: 0 },
  );
}

// Historical enrollments: give each student the SAME subject load they carry this year,
// against last year's twin of each class. D29 — this is many rows per student, not one, so
// a past-year profile shows a full subject load rather than a single class.
//
// Graduated / withdrawn students hold no CURRENT load but did sit last year, so they fall
// back to the Lower 6 default set — otherwise the archived year would show them enrolled in
// nothing, which is exactly the record a transcript needs.
const histEnrollmentId = new Map<string, string>(); // `${studentId}:${sectionId}` -> enrollment_id
let histEnrollCounter = 0;
for (const stu of students) {
  const current = loadByStudent.get(stu.id) ?? [];
  const load = current.length > 0 ? current : LOWER6_LOADS[0]!;
  for (const className of load) {
    const idx = classSeed.findIndex((c) => c.name === className);
    const sec = histSections[idx]!;
    histEnrollCounter += 1;
    const enrId = `enr-2024-${histEnrollCounter}`;
    enrollments.push({
      id: enrId,
      student_id: stu.id,
      section_id: sec.id,
      semester_id: SEM_2024_1,
      enrolled_at: '2024-09-02T08:00:00Z',
      unenrolled_at: null,
    });
    histEnrollmentId.set(`${stu.id}:${sec.id}`, enrId);
  }
}
function histRoster(sectionId: string): DemoStudent[] {
  const ids = enrollments
    .filter((e) => e.section_id === sectionId && e.semester_id === SEM_2024_1 && !e.unenrolled_at)
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
  { title: 'Midterm Test', type: 'test', catSuffix: 't', max: 50, offsetDays: -30 },
  { title: 'Final Project', type: 'assignment', catSuffix: null, max: 100, offsetDays: -10 },
];
const histAssessments: DemoAssessment[] = [];
let histAsmtCounter = 0;
for (const cs of histClassSubjects) {
  for (const tmpl of HIST_ASMT_TEMPLATES) {
    histAsmtCounter += 1;
    histAssessments.push({
      id: `asmt-2024-${histAsmtCounter}`,
      class_subject_id: cs.id,
      semester_id: SEM_2024_1,
      category_id: tmpl.catSuffix ? `cat-${cs.id}-${tmpl.catSuffix}` : null,
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
  const cs = histClassSubjects.find((c) => c.id === asmt.class_subject_id)!;
  for (const stu of histRoster(cs.section_id)) {
    const enrId = histEnrollmentId.get(`${stu.id}:${cs.section_id}`);
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
for (const sec of histSections) {
  const roster = histRoster(sec.id);
  for (const date of histAttDates) {
    for (const stu of roster) {
      const enrId = histEnrollmentId.get(`${stu.id}:${sec.id}`);
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
        section_id: sec.id,
        student_id: stu.id,
        enrollment_id: enrId,
        semester_id: SEM_2024_1,
        attendance_date: date,
        status,
        recorded_by_user_id: teacherByCode('MATH').user_id ?? principalUserId,
        recorded_at: `${date}T08:15:00Z`,
      });
    }
  }
}

// ── Assemble + freeze ───────────────────────────────────────────────────────────
export const DEMO_DATASET: DemoDataset = {
  school_profile,
  academic_years,
  semesters,
  subjects,
  sections,
  teachers,
  students,
  class_subjects,
  class_meetings,
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
};

// Convenience exported id constants module agents may reference in tests/handlers.
export const DEMO_IDS = {
  activeYearId: YEAR_ACTIVE,
  archivedYearId: YEAR_ARCHIVED,
  activeSemesterId: SEM_ACTIVE,
  principalUserId,
} as const;
