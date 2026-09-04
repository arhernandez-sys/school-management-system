/**
 * i18n stub (NFR-LOC-01). English default. Phase 7 can swap this for a real i18n
 * library (e.g. i18next/react-intl). For the foundation we centralize the strings
 * the shell uses so feature work doesn't hardcode copy.
 *
 * Keep keys stable; values are the English source strings.
 *
 * D30 — TERTIARY TERMINOLOGY. This file is now the single dictionary for the
 * institution's vocabulary, not just shell copy. BAJC is a junior college, so the
 * user-facing nouns are Dean / Registrar / Lecturer / Course — see `terms` and
 * `roles` below.
 *
 * ⚠️ DISPLAY LABELS ONLY. The wire values stay `principal | secretary | teacher |
 * student` and the remaining API/table identifiers keep their current names
 * (`teacher_profiles`, `/teachers`, …). Renaming those would invalidate the generated
 * API client and a large share of the test suite for no functional gain. Decision #3
 * in docs/tertiary-refactor-plan.md.
 *
 * D31 narrowed that exemption: the OFFERING identifiers were renamed after all, because
 * `class_subject_id` named a join table that no longer exists. `/offerings`,
 * `offering_id` and `/courses` are the wire names now.
 */

export const strings = {
  app: {
    name: 'SIMS',
    fullName: 'Student Management Information System',
    schoolName: 'Belize Adventist Junior College',
    skipToContent: 'Skip to main content',
  },
  /**
   * Domain vocabulary. Import from here rather than hardcoding a noun in a screen, so
   * the institution's wording changes in one place.
   */
  terms: {
    dean: 'Dean',
    registrar: 'Registrar',
    lecturer: 'Lecturer',
    lecturers: 'Lecturers',
    student: 'Student',
    students: 'Students',
    admissions: 'Admissions',
    course: 'Course',
    courses: 'Courses',
    /**
     * A scheduled instance of a course in a term — `course_offerings` in the schema
     * since D31 (it was `classes`, a homeroom, before): one course, one semester, an
     * optional section code, its own lecturer(s) and weekly times.
     *
     * Kept distinct from `course` on purpose. BAJC has two real concepts and the old
     * app only had one: the CATALOG entry (code, name, credits, prerequisites — what
     * the Dean manages, brief §6) and the OFFERING a student actually enrols in. Using
     * "Course" for both would make the Dean's catalog screen and the offerings list
     * read as the same thing.
     *
     * A student never sees this word — for them their offerings simply are their
     * courses ("My Courses").
     */
    courseOffering: 'Course offering',
    courseOfferings: 'Course offerings',
    courseCatalog: 'Course Catalog',
    section: 'Section',
    program: 'Program',
    programs: 'Programs',
    semester: 'Semester',
    semesters: 'Semesters',
    credits: 'Credits',
    gpa: 'GPA',
    qualityPoints: 'Quality points',
    prerequisite: 'Prerequisite',
    prerequisites: 'Prerequisites',
    application: 'Application',
    applications: 'Applications',
    transcript: 'Transcript',
  },
  /**
   * Role display labels, keyed by the wire value. The typed, exhaustive accessor lives
   * in `@shared/auth/roleLabels` — import from there, not from here, so a new role
   * cannot be added without a label.
   */
  roles: {
    principal: 'Dean',
    secretary: 'Registrar',
    teacher: 'Lecturer',
    student: 'Student',
    // D43. "Head of Department" is the client's own words and the phrase already sits in
    // `teacher_profiles.designation` as free text — so it is what staff will look for,
    // even though the unit an HOD actually heads is a PROGRAMME.
    hod: 'Head of Department',
    auditor: 'Auditor',
  },
  nav: {
    dashboard: 'Dashboard',
    students: 'Students',
    // D30 §D11 — the applicant side of the student lifecycle.
    admissions: 'Admissions',
    teachers: 'Lecturers',
    // Staff see the offerings they schedule; a student sees `myCourses` below.
    offerings: 'Course Offerings',
    assessments: 'Assessments',
    grades: 'Grades',
    attendance: 'Attendance',
    announcements: 'Announcements',
    calendar: 'Calendar',
    reports: 'Reports',
    settings: 'Settings',
    myProfile: 'My Profile',
    // Student possessive labels (design-system §3.2). A student never sees the word
    // "offering" — for them, the offerings they take simply ARE their courses.
    myCourses: 'My Courses',
    // Same label for a student and a lecturer: both mean "my own week". The page differs
    // only in whose offerings it lists, which the server decides.
    myTimetable: 'My Timetable',
    myGrades: 'My Grades',
    myAttendance: 'My Attendance',
  },
  navGroups: {
    overview: 'Overview',
    people: 'People',
    academics: 'Academics',
    myTeaching: 'My Teaching',
    mySchool: 'My School',
    communication: 'Communication',
    insights: 'Insights',
    admin: 'Admin',
    account: 'Account',
  },
  auth: {
    signIn: 'Sign in',
    signInSubtitle: 'Sign in to continue',
    identifierLabel: 'Email or username',
    passwordLabel: 'Password',
    forgotPassword: 'Forgot password? Contact your school administrator.',
    invalidCredentials: 'Invalid credentials. Please try again.',
    logout: 'Log out',
    myAccount: 'My account',
  },
  common: {
    loading: 'Loading',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
  },
  errors: {
    forbiddenTitle: '403 — Forbidden',
    forbiddenBody: "You don't have permission to view this page.",
    notFoundTitle: '404 — Page not found',
    notFoundBody: "We couldn't find the page you were looking for.",
    backToDashboard: 'Back to dashboard',
  },
} as const;

export default strings;
