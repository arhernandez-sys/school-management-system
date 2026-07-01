/**
 * Centralized, hierarchical query-key factory (architecture.md §7.1).
 *
 * Conventions:
 *  - Every feature exposes an object with `all`, `list(filters)`, `detail(id)`, etc.
 *  - Keys are hierarchical arrays so invalidation is precise:
 *      queryClient.invalidateQueries({ queryKey: students.all })  // wipes all student data
 *      queryClient.invalidateQueries({ queryKey: students.list(f) }) // just that filtered list
 *  - Filters/term/semester that scope a read become part of the key (so the global
 *    semester switcher and FilterBar URL state drive cache identity).
 *
 * Phase 6 ships auth + dashboard + reference keys (what the shell needs). Feature
 * modules (Phase 7) extend this file with their own factories following the pattern.
 */

export const authKeys = {
  all: ['auth'] as const,
  currentUser: () => [...authKeys.all, 'me'] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  bySemester: (semesterId?: string) => [...dashboardKeys.all, { semesterId }] as const,
};

/** Reference/config data (long staleTime): semesters, grading scale, school profile. */
export const settingsKeys = {
  all: ['settings'] as const,
  schoolProfile: () => [...settingsKeys.all, 'school'] as const,
  semesters: () => [...settingsKeys.all, 'semesters'] as const,
  gradingScale: () => [...settingsKeys.all, 'grading-scale'] as const,
};

// ── Phase 7 examples (kept as documented patterns; uncomment/extend per feature) ──
//
// export const studentKeys = {
//   all: ['students'] as const,
//   list: (filters: StudentFilters) => [...studentKeys.all, 'list', filters] as const,
//   detail: (id: string) => [...studentKeys.all, 'detail', id] as const,
// };
//
// export const gradeKeys = {
//   all: ['grades'] as const,
//   byClassSubject: (classSubjectId: string, term: string) =>
//     [...gradeKeys.all, 'classSubject', classSubjectId, term] as const,
//   termGrade: (studentId: string, term: string) =>
//     [...gradeKeys.all, 'termGrade', studentId, term] as const,
// };
