import { Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import { axisProps } from '@/components/ui/chart';
import { ChartPlot } from '@/components/ui/chart-plot';

/** One month of saved history; a null value is an unobserved month and draws as a gap. */
export type HistoryRow = {
  date: string;
  backlinks: number | null;
  new: number | null;
  lost: number | null;
};

/**
 * The two drawings inside `SearchIntelligenceHistory`, loaded on their own so
 * Recharts is fetched when the history is drawn rather than with the screen.
 */
export function BacklinkTotalPlot({ data }: Readonly<{ data: HistoryRow[] }>) {
  return (
    <ChartPlot>
      <LineChart data={data}>
        <XAxis {...axisProps} dataKey="date" tickFormatter={shortMonth} />
        <YAxis {...axisProps} width={48} tickFormatter={compactCount} />
        <Tooltip />
        <Line
          dataKey="backlinks"
          stroke="var(--color-backlinks)"
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartPlot>
  );
}

export function BacklinkChangesPlot({ data }: Readonly<{ data: HistoryRow[] }>) {
  return (
    <ChartPlot>
      <LineChart data={data}>
        <XAxis {...axisProps} dataKey="date" tickFormatter={shortMonth} />
        <YAxis {...axisProps} width={48} tickFormatter={compactCount} />
        <Tooltip />
        <Line
          name="New backlinks"
          dataKey="new"
          stroke="var(--color-new)"
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          name="Lost backlinks"
          dataKey="lost"
          stroke="var(--color-lost)"
          strokeDasharray="5 3"
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartPlot>
  );
}

function shortMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(2, 4)}`;
}

function compactCount(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 }).format(value);
}
