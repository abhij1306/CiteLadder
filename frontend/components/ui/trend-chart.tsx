import { useState, type KeyboardEvent } from 'react';

import {
  CHART_AXIS_TEXT,
  CHART_DASH,
  CHART_HEIGHT_PX,
  CHART_PLOT_FRAME,
  chartFill,
  chartPath,
  chartStroke,
  chartTone,
  useChartWidth,
  type ChartHeight,
  type ChartTone,
} from '@/components/ui/chart';
import { ChartKey, ChartTable, ChartTipSheet } from '@/components/ui/chart-frame';
import type { SeriesTone } from '@/components/ui/step-chart-parts';
import {
  breakConnectors,
  isolatedPoints,
  labelledIndexes,
  linePoints,
  trendScale,
  type TrendScale,
} from '@/components/ui/trend-geometry';
import { LineEndLabels } from '@/components/ui/trend-line-labels';
import { shownWith } from '@/components/ui/series-data';
import { formattedText } from '@/lib/format';
import { cn } from '@/lib/utils';

export type { TrendEvent, TrendPoint, TrendSeries } from '@/components/ui/step-chart';
import type { TrendEvent, TrendPoint, TrendSeries } from '@/components/ui/step-chart';

type Line = { name: string; values: readonly (number | null)[]; tone: ChartTone };

const KEY_TONE: Record<ChartTone, SeriesTone> = {
  1: 'you',
  2: 'rival-1',
  3: 'rival-2',
  4: 'other',
  5: 'rival-2',
};
const defaultFormat = (value: number) => `${Math.round(value * 100) / 100}`;

export function TrendChart({
  data,
  name,
  series = [],
  events = [],
  label,
  height: heightRole = 'md',
  yMin,
  yMax,
  yFormat = defaultFormat,
  format = yFormat,
  legend = true,
  eventsLabel,
  directLabels = false,
}: Readonly<{
  data: readonly TrendPoint[];
  name?: string;
  series?: readonly TrendSeries[];
  events?: readonly TrendEvent[];
  label: string;
  height?: ChartHeight;
  yMin?: number;
  yMax?: number;
  yFormat?: (value: number) => string;
  format?: (value: number) => string;
  legend?: boolean;
  eventsLabel?: string;
  directLabels?: boolean;
}>) {
  const [plotRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = CHART_HEIGHT_PX[heightRole];
  const plotted: readonly Readonly<{
    name: string;
    values: readonly (number | null)[];
    other?: boolean;
  }>[] = [
    { name: name ?? label, values: data.map((point) => point.value) },
    ...series
      .slice(0, 3)
      .map((entry) => ({ name: entry.label, values: entry.values, other: entry.other })),
  ];
  const lines: Line[] = plotted.map((line, index) => ({
    name: line.name,
    values: line.values,
    tone: chartTone(line, index),
  }));
  const shown = shownWith(format);
  const scale = trendScale({
    width,
    height,
    lines: lines.map((line) => line.values),
    timestamps: data.map((point) => point.timestamp),
    yMin,
    yMax,
    tickWidth: (ticks) => Math.max(...ticks.map((tick) => yFormat(tick).length)),
  });
  const count = data.length;
  const step = (key: string) => {
    const from = active ?? count - 1;
    return key === 'ArrowRight' ? Math.min(count - 1, from + 1) : Math.max(0, from - 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive(step(event.key));
    } else if (event.key === 'Escape') setActive(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {legend ? (
        <ChartKey
          eventsLabel={events.length ? eventsLabel : undefined}
          entries={lines.map((line) => ({
            name: line.name,
            tone: KEY_TONE[line.tone],
            value: shown(line.values.at(-1)),
          }))}
        />
      ) : null}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the plot is a keyboard-readable group */}
      <div // NOSONAR -- a keyboard-readable plot has no native element
        ref={plotRef}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- no native element reads a plot point by point
        role="group"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the arrow keys need focus on the plot
        tabIndex={count ? 0 : undefined} // NOSONAR -- the arrow keys need focus on the plot
        aria-label={`${label}. Use the left and right arrow keys to read each point.`}
        onKeyDown={onKeyDown}
        onMouseMove={(event) =>
          count &&
          setActive(scale.nearest(event.clientX - event.currentTarget.getBoundingClientRect().left))
        }
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className={CHART_PLOT_FRAME}
        style={{ height }}
      >
        <TrendPlot
          data={data}
          lines={lines}
          events={events}
          scale={scale}
          width={width}
          height={height}
          active={active}
          yFormat={yFormat}
          directLabels={directLabels && lines.length > 1}
        />
        {active === null ? null : (
          <ChartTipSheet
            title={data[active]?.label ?? ''}
            top={scale.padTop}
            x={scale.x(active)}
            frameWidth={width}
            rows={lines.map((line) => ({
              name: line.name,
              tone: KEY_TONE[line.tone],
              value: shown(line.values[active]),
            }))}
            note={data[active]?.versionChange?.note}
          />
        )}
      </div>
      <ChartTable
        label={label}
        columns={data.map((point) => point.label)}
        rows={lines.map((line) => ({
          name: line.name,
          values: data.map((_, index) => formattedText(shown(line.values[index]))),
        }))}
        notes={[
          ...data.flatMap((point) =>
            point.versionChange
              ? [`Method changed at ${point.label}: ${point.versionChange.note}`]
              : [],
          ),
          ...placedEvents(data, events, scale).map(({ event }) => event.label),
        ]}
      />
    </div>
  );
}

function TrendPlot({
  data,
  lines,
  events,
  scale,
  width,
  height,
  active,
  yFormat,
  directLabels,
}: Readonly<{
  data: readonly TrendPoint[];
  lines: readonly Line[];
  events: readonly TrendEvent[];
  scale: TrendScale;
  width: number;
  height: number;
  active: number | null;
  yFormat: (value: number) => string;
  directLabels: boolean;
}>) {
  const breaks = data.map((point) => point.breakBefore === true);
  const plotted = lines.map((line) => ({
    line,
    points: linePoints(line.values, breaks, scale),
    connectors: breakConnectors(line.values, breaks, scale),
  }));
  const bottom = scale.padTop + scale.plotHeight;
  const latest = lines[0]?.values.at(-1);
  return (
    <svg
      aria-hidden
      focusable="false"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block overflow-visible"
    >
      {scale.ticks.map((tick) => {
        const y = Math.round(scale.y(tick)) + 0.5;
        return (
          <g key={`tick-${tick}`}>
            <line
              x1={scale.padLeft}
              x2={scale.right + 8}
              y1={y}
              y2={y}
              shapeRendering="crispEdges"
              className="stroke-rule"
            />
            <text
              x={scale.padLeft - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className={CHART_AXIS_TEXT}
            >
              {yFormat(tick)}
            </text>
          </g>
        );
      })}
      {labelledIndexes(scale, data.length).map((index) => (
        <text
          key={`date-${index}`}
          x={scale.x(index)}
          y={height - 8}
          textAnchor="middle"
          className={CHART_AXIS_TEXT}
        >
          {data[index]?.axisLabel ?? data[index]?.label}
        </text>
      ))}
      <TrendMarkers data={data} events={events} scale={scale} bottom={bottom} />
      {active === null ? null : (
        <line
          x1={Math.round(scale.x(active)) + 0.5}
          x2={Math.round(scale.x(active)) + 0.5}
          y1={scale.padTop}
          y2={bottom}
          strokeDasharray="3 3"
          shapeRendering="crispEdges"
          className="stroke-control-line"
        />
      )}
      {[...plotted].reverse().map(({ line, points, connectors }) => (
        <g key={line.name} data-trend-line={line.tone}>
          <path
            d={chartPath(points)}
            fill="none"
            strokeWidth={line.tone === 1 ? 2.75 : 1.75}
            strokeDasharray={CHART_DASH[line.tone]}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={chartStroke(line.tone)}
          />
          {connectors.map(([from, to]) => (
            <path
              key={`${from[0]}-${to[0]}`}
              data-trend-connector=""
              d={chartPath([from, to])}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="3 4"
              strokeLinecap="round"
              className={cn(chartStroke(line.tone), 'opacity-40')}
            />
          ))}
          {isolatedPoints(points).map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={2.5} className={chartFill(line.tone)} />
          ))}
        </g>
      ))}
      {active === null && latest !== null && latest !== undefined ? (
        <TrendDot x={scale.x(data.length - 1)} y={scale.y(latest)} tone={1} />
      ) : null}
      {directLabels ? <LineEndLabels lines={lines} scale={scale} bottom={bottom} /> : null}
      {active === null
        ? null
        : lines.map((line) => {
            const value = line.values[active];
            return value === null || value === undefined ? null : (
              <TrendDot key={line.name} x={scale.x(active)} y={scale.y(value)} tone={line.tone} />
            );
          })}
    </svg>
  );
}

function TrendDot({ x, y, tone }: Readonly<{ x: number; y: number; tone: ChartTone }>) {
  return (
    <circle cx={x} cy={y} r={4} strokeWidth={2} className={cn('stroke-surface', chartFill(tone))} />
  );
}

function TrendMarkers({
  data,
  events,
  scale,
  bottom,
}: Readonly<{
  data: readonly TrendPoint[];
  events: readonly TrendEvent[];
  scale: TrendScale;
  bottom: number;
}>) {
  return (
    <>
      {data.map((point, index) =>
        point.versionChange ? (
          <g key={`version-${point.label}-${index}`} data-version-marker="">
            <line
              x1={scale.x(index)}
              x2={scale.x(index)}
              y1={scale.padTop}
              y2={bottom}
              strokeDasharray="4 3"
              className="stroke-warning"
            />
            <circle cx={scale.x(index)} cy={scale.padTop} r={3} className="fill-warning" />
          </g>
        ) : null,
      )}
      {placedEvents(data, events, scale).map(({ event, x }) => (
        <g key={`event-${event.key}`} data-event-marker="">
          <line
            x1={x}
            x2={x}
            y1={scale.padTop}
            y2={bottom}
            strokeDasharray="2 3"
            className="stroke-control-line"
          />
          <rect x={x - 3} y={bottom - 3} width={6} height={6} className="fill-control-line" />
        </g>
      ))}
    </>
  );
}

function placedEvents(
  data: readonly TrendPoint[],
  events: readonly TrendEvent[],
  scale: TrendScale,
) {
  const stamps = data.flatMap((point) => (point.timestamp === undefined ? [] : [point.timestamp]));
  if (stamps.length < 2 || stamps.length < data.length) return [];
  const first = Math.min(...stamps);
  const span = Math.max(...stamps) - first;
  if (span <= 0) return [];
  return events.flatMap((event) => {
    const offset = event.timestamp - first;
    if (!Number.isFinite(offset) || offset < 0 || offset > span) return [];
    return [{ event, x: scale.xAt(offset / span) }];
  });
}
