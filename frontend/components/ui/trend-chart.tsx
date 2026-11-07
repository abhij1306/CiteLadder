'use client';

import { useState, type KeyboardEvent } from 'react';

import {
  CHART_AXIS_TEXT,
  CHART_DASH,
  CHART_HEIGHT_PX,
  CHART_PLOT_FRAME,
  CHART_FILL,
  CHART_STROKE,
  ChartLegend,
  ChartTip,
  ChartTipRow,
  chartPath,
  chartTone,
  useChartWidth,
  type ChartHeight,
  type ChartTone,
} from '@/components/ui/chart';
import {
  isolatedPoints,
  labelledIndexes,
  linePoints,
  trendScale,
  type TrendScale,
} from '@/components/ui/trend-geometry';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export type TrendPoint = {
  /** The point in full ("10 Sep 2026 · run 4"): the tooltip's title and the table's column. */
  label: string;
  /** The short form under the axis, when `label` is too long to sit there. */
  axisLabel?: string;
  /** Null is unavailable and draws a gap, never a drop to zero. */
  value: number | null;
  /** Measured under a changed method: marked across the plot, with its note. */
  versionChange?: { note: string } | null;
  /** When the point was measured; with every point stamped the x axis is real time. */
  timestamp?: number;
  /** Not comparable with the point before it: every line breaks here. */
  breakBefore?: boolean;
};

/** A further line read against the first: a competitor, a second rate, "Other". */
export type TrendSeries = {
  label: string;
  values: readonly (number | null)[];
  /** The merged remainder, drawn dashed in `data-other` so it never reads as a brand. */
  other?: boolean;
};

/**
 * Something that happened at a moment, marked across the plot: drawn only
 * when the x axis is real time and the moment falls inside it. A marker says
 * when, never what it caused.
 */
export type TrendEvent = { key: string; timestamp: number; label: string };

type Line = { name: string; values: readonly (number | null)[]; tone: ChartTone };

const TIP_WIDTH = 216;
const defaultFormat = (value: number) => `${Math.round(value * 100) / 100}`;

/**
 * TrendChart — up to four lines over time in plain SVG: the first (your
 * brand) in `data-1` at 2.75px, then `data-2`, `data-3`, and Other dashed in
 * `data-other`. A legend with each line's latest value, `chart-grid`
 * gridlines, and a crosshair with a tooltip card on hover or on focus with
 * the arrow keys. A visually hidden table carries every value.
 *
 * Width follows the container (the viewBox is measured pixels, so text stays
 * 12px); the height is a chart height role (`md`, 240, by default). A
 * missing value is a gap.
 */
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
}: Readonly<{
  /** The first line, one entry per point; its labels and timestamps place every line. */
  data: readonly TrendPoint[];
  /** The first line's name in the legend and table; defaults to `label`. */
  name?: string;
  /** Up to three further lines on the same points, leader first. */
  series?: readonly TrendSeries[];
  events?: readonly TrendEvent[];
  /** What the chart shows, e.g. "Mention rate over time". */
  label: string;
  /** `sm` beside other content, `md` by default, `lg` for a page's primary chart. */
  height?: ChartHeight;
  yMin?: number;
  yMax?: number;
  /** An axis tick: `42` as `42%`. */
  yFormat?: (value: number) => string;
  /** A value in the legend, tooltip and table; defaults to `yFormat`. */
  format?: (value: number) => string;
  legend?: boolean;
  /** The legend's name for the event markers, e.g. "Marked implemented". */
  eventsLabel?: string;
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
  const shown = (value: number | null | undefined) =>
    value === null || value === undefined ? availabilityLabel('not_measured') : format(value);
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
        <ChartLegend
          line
          markerLabel={events.length ? eventsLabel : undefined}
          entries={lines.map((line) => ({
            name: line.name,
            tone: line.tone,
            value: shown(line.values.at(-1)),
          }))}
        />
      ) : null}
      {/* A focusable group: the arrow keys read the points one by one, which
          no native element does (a <fieldset> is a form group). */}
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
        />
        {active === null ? null : (
          <ChartTip
            title={data[active]?.label ?? ''}
            top={scale.padTop}
            left={tipLeft(scale.x(active), width)}
          >
            {lines.map((line) => (
              <ChartTipRow
                key={line.name}
                tone={line.tone}
                name={line.name}
                value={shown(line.values[active])}
              />
            ))}
            {data[active]?.versionChange ? (
              <p className="text-caption text-ink-muted">{data[active].versionChange.note}</p>
            ) : null}
          </ChartTip>
        )}
      </div>
      <TrendTable
        label={label}
        data={data}
        lines={lines}
        events={placedEvents(data, events, scale).map(({ event }) => event)}
        shown={shown}
      />
    </div>
  );
}

/** Beside the crosshair, flipped to its left where it would run off the plot. */
function tipLeft(x: number, width: number) {
  return x + 16 + TIP_WIDTH > width ? x - 16 - TIP_WIDTH : x + 16;
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
}: Readonly<{
  data: readonly TrendPoint[];
  lines: readonly Line[];
  events: readonly TrendEvent[];
  scale: TrendScale;
  width: number;
  height: number;
  active: number | null;
  yFormat: (value: number) => string;
}>) {
  const breaks = data.map((point) => point.breakBefore === true);
  const plotted = lines.map((line) => ({ line, points: linePoints(line.values, breaks, scale) }));
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
              className="stroke-chart-grid"
            />
            <text
              x={scale.padLeft - 10}
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
          className="stroke-line-control"
        />
      )}
      {[...plotted].reverse().map(({ line, points }) => (
        <g key={line.name} data-trend-line={line.tone}>
          <path
            d={chartPath(points)}
            fill="none"
            strokeWidth={line.tone === 1 ? 2.75 : 1.75}
            strokeDasharray={CHART_DASH[line.tone]}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={CHART_STROKE[line.tone]}
          />
          {isolatedPoints(points).map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={2.5} className={CHART_FILL[line.tone]} />
          ))}
        </g>
      ))}
      {active === null && latest !== null && latest !== undefined ? (
        <TrendDot x={scale.x(data.length - 1)} y={scale.y(latest)} tone={1} />
      ) : null}
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
    <circle
      cx={x}
      cy={y}
      r={4}
      strokeWidth={2}
      className={cn('stroke-surface', CHART_FILL[tone])}
    />
  );
}

/**
 * A method change (dashed `warning`, a dot at the top) and an event (dashed
 * `line-control`, a square on the axis) across the plot. An event is placed
 * on the time axis, so it is drawn only when every point is stamped.
 */
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
            className="stroke-line-control"
          />
          <rect x={x - 3} y={bottom - 3} width={6} height={6} className="fill-line-control" />
        </g>
      ))}
    </>
  );
}

/** Events inside the plotted time span, at their place on the axis. */
function placedEvents(
  data: readonly TrendPoint[],
  events: readonly TrendEvent[],
  scale: TrendScale,
) {
  const stamps = data.map((point) => point.timestamp);
  if (stamps.length < 2 || stamps.includes(undefined)) return [];
  const first = Math.min(...(stamps as number[]));
  const span = Math.max(...(stamps as number[])) - first;
  if (span <= 0) return [];
  return events.flatMap((event) => {
    const offset = event.timestamp - first;
    if (!Number.isFinite(offset) || offset < 0 || offset > span) return [];
    return [{ event, x: scale.padLeft + (offset / span) * scale.plotWidth }];
  });
}

/** Every value, and every drawn marker, for a reader who cannot see the plot. */
function TrendTable({
  label,
  data,
  lines,
  events,
  shown,
}: Readonly<{
  label: string;
  data: readonly TrendPoint[];
  lines: readonly Line[];
  events: readonly TrendEvent[];
  shown: (value: number | null | undefined) => string;
}>) {
  const notes = [
    ...data.flatMap((point) =>
      point.versionChange ? [`Method changed at ${point.label}: ${point.versionChange.note}`] : [],
    ),
    ...events.map((event) => event.label),
  ];
  return (
    <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            {data.map((point, index) => (
              <th key={`${point.label}-${index}`} scope="col">
                {point.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.name}>
              <th scope="row">{line.name}</th>
              {data.map((point, index) => (
                <td key={`${point.label}-${index}`}>{shown(line.values[index])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length ? (
        <ul aria-label={`${label}: marked`}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
