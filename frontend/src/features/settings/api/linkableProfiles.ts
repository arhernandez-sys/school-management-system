import { api } from '@shared/api/client';
import type { Role } from '@shared/api/generated/model';

/**
 * `GET /settings/users/linkable-profiles` — lecturer or student profiles with no login
 * yet, for the "which person is this login for?" picker on the user form.
 *
 * Hand-written rather than generated: `npm run generate:api` is forbidden in this repo.
 * The shape is `settings/schemas.py::LinkableProfile`.
 */
export interface LinkableProfile {
  id: string;
  kind: 'teacher' | 'student';
  full_name: string;
  /** staff_number for a lecturer, student_number for a student. */
  number: string;
  email: string | null;
}

export async function listLinkableProfiles(
  params: { role: Role; search?: string },
  signal?: AbortSignal,
): Promise<LinkableProfile[]> {
  const res = await api.get<LinkableProfile[]>('/settings/users/linkable-profiles', {
    params,
    signal,
  });
  return res.data;
}
