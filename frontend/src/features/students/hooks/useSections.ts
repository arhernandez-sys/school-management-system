/**
 * Lightweight section list for the Students filters + enroll picker. Sections are
 * "classes" (D23 homerooms) in the API; this reads the same GET /classes surface the
 * Classes module uses, so the option list reconciles with that screen. Cached broadly
 * (sections rarely change within a session) and shared across the list + form dialog.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';

export interface SectionOption {
  id: string;
  name: string;
  grade_level: string;
}

interface ClassListRow {
  id: string;
  name: string;
  grade_level: string;
}

export function useSectionOptions() {
  return useQuery({
    queryKey: ['sections', 'options'],
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const res = await api.get<Page<ClassListRow>>('/classes', {
        params: { page: 1, page_size: 100, sort: 'name' },
        signal,
      });
      return res.data.items.map<SectionOption>((c) => ({
        id: c.id,
        name: c.name,
        grade_level: c.grade_level,
      }));
    },
  });
}

/** Distinct grade levels derived from the section options (for the grade filter). */
export function gradeLevelsFrom(sections: SectionOption[]): string[] {
  return [...new Set(sections.map((s) => s.grade_level))].sort((a, b) => a.localeCompare(b));
}
