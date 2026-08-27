import { useState } from 'react';
import { Button, ListSubheader, Menu, MenuItem } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useSelectedYear } from '@app/providers/YearContext';

/**
 * Student-only top-bar academic-period switcher. Lists every year·semester pair the
 * student was enrolled in (grouped by year, newest first) and re-scopes their whole
 * view via YearContext. Renders nothing until the pairs have loaded.
 *
 * It used to list YEARS only, appending "· Semester 1" to the active year's label from
 * the school's active term — so it displayed a semester it could not actually select,
 * and screens below it scoped to the whole year. Every entry is now selectable, which
 * is what makes "My Assessments for Semester 2" possible.
 *
 * The year name is repeated in each option's group header rather than in the option
 * text, because semester names are NOT unique across years ("Semester 1" exists in
 * every one) — an option reading just "Semester 1" would be ambiguous, which is the
 * same trap `features/reports/components/TermPicker.tsx` documents.
 */
export function StudentYearSwitcher() {
  const { periods, selectedPeriod, setSelectedPeriod } = useSelectedYear();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (periods.length === 0 || !selectedPeriod) return null;

  // Group the flat list by year, preserving its newest-first order.
  const yearOrder: string[] = [];
  const byYear = new Map<string, typeof periods>();
  for (const p of periods) {
    if (!byYear.has(p.yearId)) {
      byYear.set(p.yearId, []);
      yearOrder.push(p.yearId);
    }
    byYear.get(p.yearId)!.push(p);
  }

  return (
    <>
      <Button
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<CalendarMonthIcon />}
        endIcon={<ArrowDropDownIcon />}
        sx={{ textTransform: 'none', fontWeight: 600 }}
        aria-label="Change academic year and semester"
      >
        {selectedPeriod.label}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {yearOrder.flatMap((yearId) => {
          const group = byYear.get(yearId)!;
          const year = group[0]!;
          return [
            <ListSubheader key={`hdr-${yearId}`} sx={{ lineHeight: '2rem' }}>
              {year.isActiveYear ? `${year.yearName} · current` : year.yearName}
            </ListSubheader>,
            ...group.map((p) => (
              <MenuItem
                key={p.semesterId}
                selected={p.semesterId === selectedPeriod.semesterId}
                onClick={() => {
                  setSelectedPeriod(p.yearId, p.semesterId);
                  setAnchor(null);
                }}
                // The label is the meaning; "current term" is never colour-only
                // (design-system §5 #12).
                aria-label={`${p.label}${p.isActiveSemester ? ' (current session)' : ''}`}
              >
                {p.isActiveSemester ? `${p.semesterName} · current session` : p.semesterName}
              </MenuItem>
            )),
          ];
        })}
      </Menu>
    </>
  );
}

export default StudentYearSwitcher;
