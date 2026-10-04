/**
 * DEMO DATASET — public entry point (frontend-only client demo).
 *
 * ONE coherent in-memory fake dataset + its selectors, which ALL MSW handlers and
 * dashboards read from so numbers reconcile across every screen. This barrel is the
 * single import path the module-screen handlers build against:
 *
 *     import { DEMO_DATASET, listStudents, computeTermGrade, DEMO_TODAY } from '@shared/api/mocks/demo/dataset';
 *
 * WHAT'S HERE
 *  - `DEMO_DATASET`     — the whole store (school, years, semesters, courses, offerings,
 *                         teachers, students, enrollments, categories, assessments, grades,
 *                         attendance, announcements, grading scale, assessment policy,
 *                         users).
 *  - Selector helpers   — listStudents / listTeachers / listCourses / getStudent /
 *                         getOffering / offeringLabel / gradebookFor / attendanceFor /
 *                         dashboardFor / computeTermGrade / paginate / … (see selectors.ts).
 *  - `DEMO_TODAY`       — the fixed "today" (2025-10-15) all recent data is anchored to.
 *  - `DEMO_IDS`         — active/archived year, active semester, principal user id.
 *  - All entity + `DemoPage<T>` types.
 *
 * **D31** — `sections` + `class_subjects` collapsed into `offerings`, and the two-id API
 * went with them. If you are looking for a name that no longer resolves:
 *
 *     getSubject / listSubjects        → getCourse / listCourses
 *     getSection / getClassSubject     → getOffering
 *     sectionsForYear                  → offeringsForYear
 *     classSubjectsForYear             → offeringsForYear (they are the same set now)
 *     semesterIdForSection             → semesterIdForOffering
 *     sectionsForStudentInYear         → offeringsForStudentInYear
 *     currentSectionsFor               → currentOfferingsFor
 *     classSubjectsForStudent          → offeringsForStudent
 *     classSubjectsForSection(s)       → (gone — an offering has no parent to look up)
 *     sectionsOwnedByTeacher /
 *       classSubjectsOwnedByTeacher    → offeringsOwnedByTeacher (one function, not two)
 *     meetingsForSection               → meetingsForOffering
 *     assessmentsForClassSubject       → assessmentsForOffering
 *     attendanceSummaryForSection      → attendanceSummaryForOffering
 *     enrollmentByGrade                → enrollmentByYearOfStudy
 *
 * `offeringLabel(offering)` is NEW and is the only sanctioned way to name an offering — a
 * row stores no name, and deriving the label anywhere else is how the demo starts
 * disagreeing with the API about what a thing is called.
 *
 * DETERMINISM: the dataset is built once at module load with fixed seeds and a fixed
 * "today" — no Date.now()/Math.random() — so it is byte-stable across reloads.
 *
 * CONVENTIONS
 *  - Wire format is snake_case; entity rows already use snake_case fields, so handlers
 *    mostly pick/rename into the exact api-spec response shapes.
 *  - `paginate(items, params)` returns `{ items, total, page, page_size, total_pages }`
 *    — the `Page[T]` envelope (api-spec §4.1). `page` is 1-based; `page_size` clamps ≤200
 *    (`MAX_PAGE_SIZE`; it said 100 here until D43, which did not match the server).
 *  - Handlers may MUTATE `DEMO_DATASET` arrays for create/update/delete in-session.
 */

export { DEMO_DATASET, DEMO_IDS, DEMO_TODAY, DEMO_TODAY_ISO } from './data';

export {
  // D43 — HOD programme scope (mirrors backend/app/core/rbac.py).
  demoHodProgramIds,
  demoHodOfferingIds,
  demoHodStudentIds,
  demoHodTeacherIds,
  currentDemoHodTeacher,
  paginate,
  getCourse,
  getOffering,
  getTeacher,
  getStudent,
  getSemester,
  offeringLabel,
  compareOfferings,
  yearIdOfOffering,
  getActiveSemester,
  getActiveYear,
  getActiveGradingScale,
  listAcademicYears,
  offeringsForYear,
  primarySemesterIdForYear,
  semesterIdForOffering,
  studentIdsForYear,
  teacherIdsForYear,
  yearsForStudent,
  offeringsForStudentInYear,
  offeringsForStudent,
  currentOfferingsFor,
  meetingsForOffering,
  attendanceRateForStudent,
  DEMO_REPRESENTATIVE_USER_ID,
  currentDemoStudent,
  currentDemoTeacher,
  listStudents,
  listTeachers,
  listCourses,
  offeringsOwnedByTeacher,
  rosterFor,
  activeEnrollmentFor,
  enrolledCount,
  assessmentsForOffering,
  gradesForAssessment,
  gradebookFor,
  midtermRevisionEligible,
  studentReligions,
  studentCivilStatuses,
  computeTermGrade,
  letterFor,
  gradePointFor,
  gpaFor,
  passedCourseIds,
  courseResultsFor,
  unmetPrerequisites,
  attendanceFor,
  attendanceSummaryForOffering,
  schoolAttendanceRate,
  announcementsForUser,
  unreadCountForUser,
  dashboardFor,
  enrollmentByYearOfStudy,
  gradeDistribution,
  getEvent,
  listEvents,
} from './selectors';

export type { ListStudentsParams, ListTeachersParams, ListCoursesParams } from './selectors';

export type {
  DemoDataset,
  DemoPage,
  DemoListParams,
  DemoSchoolProfile,
  DemoAcademicYear,
  DemoSemester,
  DemoCourse,
  DemoOffering,
  DemoOfferingMeeting,
  DemoTeacher,
  DemoStudent,
  DemoEnrollment,
  DemoEvent,
  EventCategory,
  EventVisibility,
  DemoAssessmentCategory,
  DemoAssessment,
  DemoAssessmentGrade,
  DemoAttendanceRecord,
  DemoAnnouncement,
  DemoApplication,
  DemoApplicationTemp,
  DemoApplicationEducation,
  DemoApplicationDocument,
  DemoCreditTransferRequest,
  DemoGradeRevisionRequest,
  DemoStudentProgramHistory,
  DemoGradingBand,
  DemoGradingScale,
  DemoAssessmentPolicy,
  DemoUser,
} from './types';
