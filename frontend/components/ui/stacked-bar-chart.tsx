import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { CHART_HEIGHT_PX, useChartWidth, type ChartHeight } from '@/components/ui/chart';
import { ChartFrame, ChartTable } from '@/components/ui/chart-frame';
import {
  AXIS_PROPS,
  BAR_CURSOR,
  ChartTooltipCard,
  GRID_PROPS,
  roleColor,
} from '@/components/ui/chart-tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export type StackedSeries = Readonly<{ name: string; fill: string }>;

export type StackedBar = Readonly<{
  key: string;
  label: string;
  axisLabel: string;
  values: readonly number[];
  breakBefore?: boolean;
}>;

export function StackedBarChart({
  label,
  series,
  bars,
  breakNote,
  height: heightRole = 'sm',
}: Readonly<{
  label: string;
  series: readonly StackedSeries[];
  bars: readonly StackedBar[];
  breakNote: string;
  height?: ChartHeight;
}>) {
  const [plotRef, width] = useChartWidth<HTMLDivElement>();
  const height = CHART_HEIGHT_PX[heightRole];
  const rows = bars.map((bar) => ({
    key: bar.key,
    axisLabel: bar.axisLabel,
    ...Object.fromEntries(series.map((_, part) => [`s${part}`, bar.values[part] ?? 0])),
  }));
  const marked = bars.some((bar) => bar.breakBefore);
  return (
    <ChartFrame
      height={heightRole}
      summary={`${label}: ${bars.length} ${bars.length === 1 ? 'period' : 'periods'}.`}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div
          ref={plotRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- no native element names a plot as one group
          role="group"
          aria-label={`${label}. Focus the chart and use the arrow keys to read each bar.`}
          className="w-full"
          style={{ height }}
        >
          <BarChart
            width={width}
            height={height}
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              {...AXIS_PROPS}
              dataKey="key"
              tickFormatter={(_, index) => rows[index]?.axisLabel ?? ''}
            />
            <YAxis {...AXIS_PROPS} width="auto" allowDecimals={false} tickCount={4} />
            {bars.map((bar) =>
              bar.breakBefore ? (
                <ReferenceLine
                  key={`break-${bar.key}`}
                  x={bar.key}
                  position="start"
                  stroke="var(--color-warning)"
                  strokeDasharray="4 3"
                />
              ) : null,
            )}
            <Tooltip
              cursor={BAR_CURSOR}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const key = (payload?.[0]?.payload as { key?: string } | undefined)?.key;
                const bar = bars.find((entry) => entry.key === key);
                if (!active || !bar) return null;
                return (
                  <ChartTooltipCard
                    title={bar.label}
                    note={bar.breakBefore ? breakNote : undefined}
                    rows={series.map((entry, part) => ({
                      name: entry.name,
                      color: roleColor(entry.fill, 'fill'),
                      value: String(bar.values[part] ?? 0),
                    }))}
                  />
                );
              }}
            />
            {series.map((entry, part) => (
              <Bar
                key={entry.name}
                dataKey={`s${part}`}
                name={entry.name}
                stackId="stack"
                maxBarSize={32}
                fill={roleColor(entry.fill, 'fill')}
                radius={part === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </div>
        <ul aria-hidden className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
          {series.map((entry) => (
            <li key={entry.name} className={textRole('caption', 'inline-flex items-center gap-2')}>
              <Swatch fill={entry.fill} />
              {entry.name}
            </li>
          ))}
          {marked ? (
            <li className={textRole('caption', 'inline-flex items-center gap-2')}>
              <span className="border-warning inline-block h-3 w-0 shrink-0 border-l border-dashed" />
              {breakNote}
            </li>
          ) : null}
        </ul>
        <ChartTable
          label={label}
          columns={bars.map((bar) => bar.label)}
          rows={series.map((entry, part) => ({
            name: entry.name,
            values: bars.map((bar) => String(bar.values[part] ?? 0)),
          }))}
          notes={bars.flatMap((bar) => (bar.breakBefore ? [`${bar.label}: ${breakNote}`] : []))}
        />
      </div>
    </ChartFrame>
  );
}

function Swatch({ fill }: Readonly<{ fill: string }>) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', fill)} />;
}
