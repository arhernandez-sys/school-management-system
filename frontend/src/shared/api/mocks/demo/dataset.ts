/**
 * DEMO DATASET — public entry point (frontend-only client demo).
 *
 * ONE coherent in-memory fake dataset + its selectors, which ALL MSW handlers and
 * dashboards read from so numbers reconcile across every screen. This barrel is the
 * single import path the 9 module-screen agents build against:
 *
 *     import { DEMO_DATASET, listStudents, computeTermGrade, DEMO_TODAY } from '@shared/api/mocks/demo/dataset';
 *
 * WHAT'S HERE
 *  - `DEMO_DATASET`     — the whole store (school, years, semesters, subjects, sections,
 *                         teachers, students, class_subjects, enrollments, categories,
 *                         assessments, grades, attendance, announcements, grading scale,
 *                         assessment policy, users).
 *  - Selector helpers   — listStudents / listTeachers / listSubjects / getStudent /
 *                         getSection / gradebookFor / attendanceFor / dashboardFor /
 *                         computeTermGrade / paginate / … (see selectors.ts).
 *  - `DEMO_TODAY`       — the fixed "today" (2025-10-15) all recent data is anchored to.
 *  - `DEMO_IDS`         — active/archived year, active semester, principal user id.
 *  - All entity + `DemoPage<T>` types.
 *
 * DETERMINISM: the dataset is built once at module load with fixed seeds and a fixed
 * "today" — no Date.now()/Math.random() — so it is byte-stable across reloads.
 *
 * CONVENTIONS
 *  - Wire format is snake_case; entity rows already use snake_case fields, so handlers
 *    mostly pick/rename into the exact api-spec response shapes.
 *  - `paginate(items, params)` returns `{ items, total, page, page_size, total_pages }`
 *    — the `Page[T]` envelope (api-spec §4.1). `page` is 1-based; `page_size` clamps ≤100.
 *  - Handlers may MUTATE `DEMO_DATASET` arrays for create/update/delete in-session.
 */

export { DEMO_DATASET, DEMO_IDS, DEMO_TODAY, DEMO_TODAY_ISO } from './data';

export {
  paginate,
  getSubject,
  getSection,
  getTeacher,
  getStudent,
  getClassSubject,
  getActiveSemester,
  getActiveYear,
  getActiveGradingScale,
  listAcademicYears,
  sectionsForYear,
  primarySemesterIdForYear,
  semesterIdForSection,
  classSubjectsForYear,
  studentIdsForYear,
  teacherIdsForYear,
  yearsForStudent,
  sectionsForStudentInYear,
  classSubjectsForStudent,
  classSubjectsForSections,
  currentSectionsFor,
  meetingsForSection,
  attendanceRateForStudent,
  DEMO_REPRESENTATIVE_USER_ID,
  currentDemoStudent,
  currentDemoTeacher,
  listStudents,
  listTeachers,
  listSubjects,
  classSubjectsForSection,
  sectionsOwnedByTeacher,
  classSubjectsOwnedByTeacher,
  rosterFor,
  activeEnrollmentFor,
  enrolledCount,
  assessmentsForClassSubject,
  gradesForAssessment,
  gradebookFor,
  computeTermGrade,
  letterFor,
  attendanceFor,
  attendanceSummaryForSection,
  schoolAttendanceRate,
  announcementsForUser,
  unreadCountForUser,
  dashboardFor,
  enrollmentByGrade,
  gradeDistribution,
  getEvent,
  listEvents,
} from './selectors';

export type {
  ListStudentsParams,
  ListTeachersParams,
  ListSubjectsParams,
} from './selectors';

export type {
  DemoDataset,
  DemoPage,
  DemoListParams,
  DemoSchoolProfile,
  DemoAcademicYear,
  DemoSemester,
  DemoSubject,
  DemoSection,
  DemoTeacher,
  DemoStudent,
  DemoClassSubject,
  DemoEnrollment,
  DemoEvent,
  EventCategory,
  EventVisibility,
  DemoAssessmentCategory,
  DemoAssessment,
  DemoAssessmentGrade,
  DemoAttendanceRecord,
  DemoAnnouncement,
  DemoGradingBand,
  DemoGradingScale,
  DemoAssessmentPolicy,
  DemoUser,
} from './types';
