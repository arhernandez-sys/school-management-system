/**
 * Settings data hooks (api-spec §11). Thin wrappers over the ORVAL-GENERATED
 * query/mutation hooks so features own invalidation while transport stays in the
 * shared mutator. Reference/config data (school, grading scale, policy, years) is
 * given a long staleTime — it changes rarely and is read on many screens.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSchoolApiV1SettingsSchoolGet,
  useUpdateSchoolApiV1SettingsSchoolPut,
  useListAcademicYearsApiV1SettingsAcademicYearsGet,
  useCreateAcademicYearApiV1SettingsAcademicYearsPost,
  useActivateSemesterApiV1SettingsSemestersSemesterIdActivatePatch,
  useArchiveAcademicYearApiV1SettingsAcademicYearsYearIdArchivePost,
  useGetGradingScaleApiV1SettingsGradingScaleGet,
  useUpdateGradingScaleApiV1SettingsGradingScalePut,
  useGetAssessmentPolicyApiV1SettingsAssessmentPolicyGet,
  useUpdateAssessmentPolicyApiV1SettingsAssessmentPolicyPut,
  useListUsersApiV1SettingsUsersGet,
  useCreateUserApiV1SettingsUsersPost,
  useUpdateUserApiV1SettingsUsersUserIdPatch,
  useGetAccountApiV1SettingsAccountGet,
  useUpdateAccountApiV1SettingsAccountPatch,
  useGetActiveTermApiV1SettingsActiveTermGet,
  getListAcademicYearsApiV1SettingsAcademicYearsGetQueryKey,
  getGetGradingScaleApiV1SettingsGradingScaleGetQueryKey,
  getGetAssessmentPolicyApiV1SettingsAssessmentPolicyGetQueryKey,
  getListUsersApiV1SettingsUsersGetQueryKey,
  getGetAccountApiV1SettingsAccountGetQueryKey,
  getGetActiveTermApiV1SettingsActiveTermGetQueryKey,
  getGetSchoolApiV1SettingsSchoolGetQueryKey,
} from '@shared/api/generated/settings/settings';
import { useResetUserPasswordApiV1AuthUsersUserIdResetPasswordPost } from '@shared/api/generated/auth/auth';
import type {
  ListUsersApiV1SettingsUsersGetParams,
  GetGradingScaleApiV1SettingsGradingScaleGetParams,
} from '@shared/api/generated/model';

const CONFIG_STALE_MS = 5 * 60 * 1000; // 5 min — reference data changes rarely.

// ── School profile ────────────────────────────────────────────────────────────
export function useSchoolProfile() {
  return useGetSchoolApiV1SettingsSchoolGet({ query: { staleTime: CONFIG_STALE_MS } });
}

export function useUpdateSchoolProfile() {
  const qc = useQueryClient();
  return useUpdateSchoolApiV1SettingsSchoolPut({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getGetSchoolApiV1SettingsSchoolGetQueryKey() }),
    },
  });
}

// ── Academic structure (years + semesters) ─────────────────────────────────────
/**
 * GET /settings/academic-years — every year with its semesters.
 *
 * Readable by ALL authenticated roles (widened 2026-07-29): this is the calendar every
 * period picker is built from — the staff `?year=` filter (`useYearFilter`) and the
 * student's global year·semester switcher, which joins it against
 * `GET /students/me/years` for the semesters. It was P/S-only, so a teacher's picker
 * got a 403 and silently emptied.
 *
 * `enabled` mirrors {@link useActiveTerm}: YearProvider mounts ABOVE the route guards,
 * so it must hold the request until the session exists or eat a 401 on every reload.
 */
export function useAcademicYears(options?: { enabled?: boolean }) {
  return useListAcademicYearsApiV1SettingsAcademicYearsGet({
    query: { staleTime: CONFIG_STALE_MS, enabled: options?.enabled ?? true },
  });
}

function useInvalidateAcademicStructure() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: getListAcademicYearsApiV1SettingsAcademicYearsGetQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetActiveTermApiV1SettingsActiveTermGetQueryKey() });
  };
}

export function useCreateAcademicYear() {
  const invalidate = useInvalidateAcademicStructure();
  return useCreateAcademicYearApiV1SettingsAcademicYearsPost({ mutation: { onSuccess: invalidate } });
}

export function useActivateSemester() {
  const invalidate = useInvalidateAcademicStructure();
  return useActivateSemesterApiV1SettingsSemestersSemesterIdActivatePatch({
    mutation: { onSuccess: invalidate },
  });
}

export function useArchiveAcademicYear() {
  const invalidate = useInvalidateAcademicStructure();
  return useArchiveAcademicYearApiV1SettingsAcademicYearsYearIdArchivePost({
    mutation: { onSuccess: invalidate },
  });
}

// ── Grading scale ───────────────────────────────────────────────────────────────
export function useGradingScale(params?: GetGradingScaleApiV1SettingsGradingScaleGetParams) {
  return useGetGradingScaleApiV1SettingsGradingScaleGet(params, {
    query: { staleTime: CONFIG_STALE_MS },
  });
}

export function useUpdateGradingScale() {
  const qc = useQueryClient();
  return useUpdateGradingScaleApiV1SettingsGradingScalePut({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getGetGradingScaleApiV1SettingsGradingScaleGetQueryKey() }),
    },
  });
}

// ── Assessment policy ────────────────────────────────────────────────────────────
export function useAssessmentPolicy() {
  return useGetAssessmentPolicyApiV1SettingsAssessmentPolicyGet({
    query: { staleTime: CONFIG_STALE_MS },
  });
}

export function useUpdateAssessmentPolicy() {
  const qc = useQueryClient();
  return useUpdateAssessmentPolicyApiV1SettingsAssessmentPolicyPut({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({
          queryKey: getGetAssessmentPolicyApiV1SettingsAssessmentPolicyGetQueryKey(),
        }),
    },
  });
}

// ── Users admin ───────────────────────────────────────────────────────────────────
export function useUsersList(params: ListUsersApiV1SettingsUsersGetParams) {
  return useListUsersApiV1SettingsUsersGet(params, {
    query: { placeholderData: (prev) => prev },
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getListUsersApiV1SettingsUsersGetQueryKey() });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useCreateUserApiV1SettingsUsersPost({ mutation: { onSuccess: invalidate } });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useUpdateUserApiV1SettingsUsersUserIdPatch({ mutation: { onSuccess: invalidate } });
}

export function useResetUserPassword() {
  return useResetUserPasswordApiV1AuthUsersUserIdResetPasswordPost();
}

// ── Account / preferences (self) ────────────────────────────────────────────────
export function useAccount() {
  return useGetAccountApiV1SettingsAccountGet();
}

// ── Active term (global semester switcher) ──────────────────────────────────────
/**
 * GET /settings/active-term. 409 no_active_semester when the school has no active
 * year/semester — the caller degrades to a setup prompt. Retries are disabled so a
 * 409 (a valid "not set up" state, not a transient error) surfaces immediately.
 *
 * `enabled` exists so callers mounted ABOVE the route guards (YearProvider) can hold
 * the request until the session is established. Without it the query fires during
 * AuthProvider's bootstrap, when no access token is in memory yet, and eats a
 * guaranteed 401 on every hard reload. The client's interceptor does recover it —
 * the 401 coalesces onto the same single-flight `performRefresh()` the bootstrap is
 * already running and is replayed — but it costs a round-trip and puts a red herring
 * in the console. Defaults to true so existing callers are unaffected.
 */
export function useActiveTerm(options?: { enabled?: boolean }) {
  return useGetActiveTermApiV1SettingsActiveTermGet({
    query: { staleTime: CONFIG_STALE_MS, retry: false, enabled: options?.enabled ?? true },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useUpdateAccountApiV1SettingsAccountPatch({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetAccountApiV1SettingsAccountGetQueryKey() }),
    },
  });
}
