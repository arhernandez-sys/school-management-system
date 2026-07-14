import { useId, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * ChartWithTable — accessible Recharts wrapper (design-system §5 #5, §9.5).
 *
 * A chart is not accessible on its own (SVG conveys meaning visually). This wrapper
 * always renders an equivalent data table: it is visually hidden by default (available
 * to screen readers) and can be toggled visible for sighted keyboard users. One `data`
 * array drives both the chart and the table, so they can never disagree.
 *
 * Supports `type` = 'bar' | 'line' | 'pie'. Colors come from the theme palette (no raw
 * hex). The chart SVG is `aria-hidden`; the table is the accessible source of truth.
 */
export interface ChartDatum {
  /** Category label (x-axis / slice label / first table column). */
  name: string;
  /** Numeric value plotted. */
  value: number;
  [key: string]: string | number;
}

export interface ChartWithTableProps {
  title: string;
  data: ChartDatum[];
  type?: 'bar' | 'line' | 'pie';
  /** Header for the value column in the data table (e.g. "Students"). */
  valueLabel?: string;
  /** Header for the category column (e.g. "Grade"). */
  categoryLabel?: string;
  height?: number;
  /** Start with the data table shown (default false = visually hidden). */
  showTableByDefault?: boolean;
}

export function ChartWithTable({
  title,
  data,
  type = 'bar',
  valueLabel = 'Value',
  categoryLabel = 'Category',
  height = 280,
  showTableByDefault = false,
}: ChartWithTableProps) {
  const theme = useTheme();
  const [tableVisible, setTableVisible] = useState(showTableByDefault);
  const tableId = useId();

  const palette = [
    theme.palette.primary.main,
    theme.palette.secondary.main,
    theme.palette.info.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.error.main,
  ];

  const chart = (
    <ResponsiveContainer width="100%" height={height}>
      {type === 'bar' ? (
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
          <Tooltip />
          <Bar dataKey="value" name={valueLabel} fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
        </BarChart>
      ) : type === 'line' ? (
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="value"
            name={valueLabel}
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      ) : (
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={height / 3} label>
            {data.map((_, i) => (
              <Cell key={i} fill={palette[i % palette.length]} />
            ))}
          </Pie>
          <Legend />
          <Tooltip />
        </PieChart>
      )}
    </ResponsiveContainer>
  );

  const dataTable = (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
      <Table size="small" aria-label={`${title} data`}>
        <TableHead>
          <TableRow>
            <TableCell>{categoryLabel}</TableCell>
            <TableCell align="right">{valueLabel}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((d) => (
            <TableRow key={d.name}>
              <TableCell>{d.name}</TableCell>
              <TableCell align="right">{d.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}
      >
        <Typography variant="h4" component="h3">
          {title}
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={() => setTableVisible((v) => !v)}
          aria-expanded={tableVisible}
          aria-controls={tableId}
        >
          {tableVisible ? 'Hide data table' : 'Show data table'}
        </Button>
      </Stack>

      <Box aria-hidden>{chart}</Box>

      {/* Accessible equivalent: hidden visually unless toggled, always in the a11y tree. */}
      <Box
        id={tableId}
        sx={
          tableVisible
            ? undefined
            : {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '1px',
                height: '1px',
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
              }
        }
      >
        {dataTable}
      </Box>
    </Box>
  );
}

export default ChartWithTable;
