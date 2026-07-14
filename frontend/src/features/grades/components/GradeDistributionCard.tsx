import { useMemo } from 'react';
import { Paper } from '@mui/material';
import { ChartWithTable, type ChartDatum } from '@shared/components';
import { getActiveGradingScale } from '@shared/api/mocks/demo/dataset';
import type { Gradebook } from '../types';

/**
 * Grade distribution for the current gradebook — a bar chart of how many students fall
 * in each letter band (computed from the live term grades). Uses the shared
 * ChartWithTable so the chart always ships an accessible data-table equivalent (§9.5).
 */
export interface GradeDistributionCardProps {
  gradebook: Gradebook;
}

export function GradeDistributionCard({ gradebook }: GradeDistributionCardProps) {
  const data = useMemo<ChartDatum[]>(() => {
    const scale = getActiveGradingScale();
    const counts = new Map<string, number>();
    // Seed every band at 0 so empty bands still render a labelled bar.
    if (scale) for (const b of [...scale.bands].sort((a, b) => a.sort_order - b.sort_order)) counts.set(b.letter, 0);
    for (const row of gradebook.rows) {
      if (row.term_letter) counts.set(row.term_letter, (counts.get(row.term_letter) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [gradebook.rows]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <ChartWithTable
        title="Grade distribution"
        data={data}
        type="bar"
        categoryLabel="Letter"
        valueLabel="Students"
        height={220}
      />
    </Paper>
  );
}

export default GradeDistributionCard;
