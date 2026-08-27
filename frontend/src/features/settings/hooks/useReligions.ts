import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';

/**
 * The Religion vocabulary (D39, Meeting #2 item 8).
 *
 * Hand-written transport for the same reason as `usePrerequisites`: the endpoint is new,
 * absent from the served OpenAPI, and `npm run generate:api` is forbidden here.
 *
 * **This list constrains the WRITE PATH, not the column.** `student_profiles.religion`
 * remains free-text `varchar(100)`, and the directory's Religion filter still discovers
 * its options from what has actually been entered. That is D37's rule, and it is what
 * lets a student imported from the client's previous system keep a religion this list
 * does not carry instead of having it rejected or blanked on the next save.
 *
 * Consequences for any form using this:
 *
 *  * The select MUST tolerate a stored value that is not in the list — render it as an
 *    extra "(as recorded)" option rather than opening blank. A value absent from the
 *    options renders an EMPTY select, and saving from a blank select clears the field,
 *    so a legacy religion would be silently destroyed by an unrelated edit.
 *  * An empty vocabulary is a legitimate state, not an error: a school that has not
 *    populated the table yet should get a dropdown with no options, not a broken screen.
 */
export interface ReligionItem {
  id: number;
  name: string;
  /** e.g. `SDA`. The client's own reports use it; nothing here writes it. */
  code_name: string | null;
}

export interface ReligionList {
  items: ReligionItem[];
}

export const religionKeys = {
  all: ['religions'] as const,
};

export function useReligions() {
  return useQuery({
    queryKey: religionKeys.all,
    queryFn: async ({ signal }) => {
      const res = await api.get<ReligionList>('/settings/religions', { signal });
      return res.data;
    },
    // A vocabulary, not a transaction log: it changes when the client edits their own
    // lookup table, which is roughly never during a session.
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * The religion options to render, with `current` guaranteed present.
 *
 * Centralised because getting it wrong is silent: forgetting the stored value opens the
 * select blank and the next save writes an empty religion over a real one.
 */
export function religionOptions(
  items: ReligionItem[] | undefined,
  current: string | null | undefined,
): Array<{ value: string; label: string; legacy: boolean }> {
  const list = (items ?? []).map((r) => ({ value: r.name, label: r.name, legacy: false }));
  const stored = (current ?? '').trim();
  if (!stored) return list;
  // Case-insensitively, because MariaDB's collation is and a stored 'catholic' must not
  // produce a second option next to 'Catholic'.
  const known = list.some((o) => o.value.toLowerCase() === stored.toLowerCase());
  return known
    ? list
    : [...list, { value: stored, label: `${stored} (as recorded)`, legacy: true }];
}
