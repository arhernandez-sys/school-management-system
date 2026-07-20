import { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useSelectedYear } from '@app/providers/YearContext';

/**
 * Student-only top-bar academic-year switcher. Shows the selected year (e.g.
 * "2025-2026 · Semester 1" for the active year) and opens a dropdown of the years the
 * student was enrolled in. Picking one re-scopes their whole view via YearContext.
 * Renders nothing until the student's years have loaded.
 */
export function StudentYearSwitcher() {
  const { selectedYearId, setSelectedYearId, years, activeYearId, activeSemesterName } =
    useSelectedYear();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (years.length === 0) return null;

  const labelFor = (yearName: string, isActive: boolean) =>
    isActive && activeSemesterName ? `${yearName} · ${activeSemesterName}` : yearName;

  const selected = years.find((y) => y.id === selectedYearId) ?? years[0]!;

  return (
    <>
      <Button
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<CalendarMonthIcon />}
        endIcon={<ArrowDropDownIcon />}
        sx={{ textTransform: 'none', fontWeight: 600 }}
        aria-label="Change academic year"
      >
        {labelFor(selected.name, selected.id === activeYearId)}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {years.map((y) => (
          <MenuItem
            key={y.id}
            selected={y.id === selected.id}
            onClick={() => {
              setSelectedYearId(y.id);
              setAnchor(null);
            }}
          >
            {labelFor(y.name, y.id === activeYearId)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default StudentYearSwitcher;
