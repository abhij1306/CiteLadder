import { Fragment, useState, type KeyboardEvent } from 'react';

import {
  CHART_DASH,
  CHART_FILL,
  CHART_AXIS_TEXT,
  CHART_PLOT_FRAME,
  CHART_STROKE,
  ChartTip,
  ChartTipRow,
  chartPath,
  useChartWidth,
  type ChartTone,
} from '@/components/ui/chart';
import {
  isolatedPoints,
  linePoints,
  trendScale,
  type TrendScale,
} from '@/components/ui/trend-geometry';
import { textRole } from '@/components/ui/typography';
import { formatShortDate } from '@/lib/format';
import {
  computeTickIndices,
  formatMetric,
  isInvertedMetric,
  type PerformanceChartPoint,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';
import { cn } from '@/lib/utils';

import type { ChartSeries } from './performance-chart';

/** The page's primary chart: the `lg` plot height. */
const HEIGHT = 320;
const TIP_WIDTH = 216;
/** A comparison window's line: dotted, so it never reads as Other's dash. */
const COMPARISON_DASH = '0.01 4';

type Heights = readonly (number | null)[];

/** One metric in plot terms: each value as a height on the metric's OWN domain. */
type PlotLine = Readonly<{
  key: PerformanceMetricKey;
  tone: ChartTone;
  selected: Heights;
  comparison: Heights | null;
}>;

/**
 * Where a value sits on its metric's own domain, 0 the floor and 1 the top. A
 * rank is flipped, so the better (smaller) position is drawn higher. Null is
 * unmeasured and stays null: a gap, never a drop to zero.
 */
function heightOf(
  value: number | null | undefined,
  [low, high]: readonly [number, number],
  inverted: boolean,
): number | null {
  if (value === null || value === undefined) return null;
  const fraction = (value - low) / (high - low || 1);
  return inverted ? 1 - fraction : fraction;
}

function plotLines(
  series: readonly ChartSeries[],
  columnCount: number,
  domains: ReadonlyMap<PerformanceMetricKey, [number, number]>,
): PlotLine[] {
  return series.map((entry) => {
    const domain: readonly [number, number] = domains.get(entry.key) ?? [0, 1];
    const inverted = isInvertedMetric(entry.key);
    const heights = (points: readonly PerformanceChartPoint[]) =>
      Array.from({ length: columnCount }, (_, index) =>
        heightOf(points[index]?.value, domain, inverted),
      );
    return {
      key: entry.key,
      tone: entry.tone,
      selected: heights(entry.selected),
      comparison: entry.comparison ? heights(entry.comparison) : null,
    };
  });
}

function dayTitle(index: number, date: string | null | undefined): string {
  return date ? `Day ${index + 1} · ${date}` : `Day ${index + 1}`;
}

/** A metric's value at a position, with its comparison peer when one is drawn. */
function tipValue(entry: ChartSeries, index: number): string {
  const value = formatMetric(entry.key, entry.selected[index]?.value ?? null);
  if (!entry.comparison) return value;
  return `${value} vs ${formatMetric(entry.key, entry.comparison[index]?.value ?? null)}`;
}

/** Beside the crosshair, flipped to its left where it would run off the plot. */
function tipLeft(x: number, width: number) {
  return x + 16 + TIP_WIDTH > width ? x - 16 - TIP_WIDTH : x + 16;
}

/**
 * The drawing inside `PerformanceChart`: every selected metric on one plot,
 * each on its own value domain (so there is no value axis, only dates), its
 * comparison window dotted beside it. A crosshair and a hover card on hover,
 * or on focus with the arrow keys; a visually hidden table carries every value.
 */
export function PerformancePlot({
  series,
  columnCount,
  domains,
  axisEntry,
  label,
}: Readonly<{
  series: readonly ChartSeries[];
  columnCount: number;
  /** Each metric's own value domain, by metric key. */
  domains: ReadonlyMap<PerformanceMetricKey, [number, number]>;
  /** The longest selected series, which dates the axis and the hover card. */
  axisEntry: ChartSeries | null;
  /** What the plot shows, e.g. "Clicks over 28 days". */
  label: string;
}>) {
  const [plotRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const lines = plotLines(series, columnCount, domains);
  const scale = trendScale({
    width,
    height: HEIGHT,
    lines: [],
    timestamps: Array.from({ length: columnCount }, () => undefined),
    yMin: 0,
    yMax: 1,
    // No value axis: the gutter only keeps the first date inside the plot.
    tickWidth: () => 3,
  });
  const step = (key: string) => {
    const from = active ?? columnCount - 1;
    return key === 'ArrowRight' ? Math.min(columnCount - 1, from + 1) : Math.max(0, from - 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive(step(event.key));
    } else if (event.key === 'Escape') setActive(null);
  };
  const shownActive = active !== null && active < columnCount ? active : null;

  return (
    <div className="min-w-0">
      {/* A focusable group: the arrow keys read the days one by one, which
          no native element does (a <fieldset> is a form group). */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the plot is a keyboard-readable group */}
      <div // NOSONAR -- a keyboard-readable plot has no native element
        ref={plotRef}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- no native element reads a plot point by point
        role="group"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the arrow keys need focus on the plot
        tabIndex={0} // NOSONAR -- the arrow keys need focus on the plot
        aria-label={`${label}. Use the left and right arrow keys to read each point.`}
        onKeyDown={onKeyDown}
        onMouseMove={(event) =>
          setActive(scale.nearest(event.clientX - event.currentTarget.getBoundingClientRect().left))
        }
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className={CHART_PLOT_FRAME}
        style={{ height: HEIGHT }}
      >
        <PlotDrawing
          lines={lines}
          scale={scale}
          width={width}
          columnCount={columnCount}
          dates={axisEntry?.selected ?? []}
          active={shownActive}
        />
        {shownActive === null ? null : (
          <PerformanceTip
            series={series}
            index={shownActive}
            dateSource={axisEntry}
            top={scale.padTop}
            left={tipLeft(scale.x(shownActive), width)}
          />
        )}
      </div>
      <PerformanceTable
        label={label}
        series={series}
        columnCount={columnCount}
        dateSource={axisEntry}
      />
    </div>
  );
}

/**
 * The hover card: each metric's value at this position and, while a
 * comparison is drawn, the comparison bucket's value and its own date, so a
 * dotted point is never ambiguous about which day it represents.
 */
function PerformanceTip({
  series,
  index,
  dateSource,
  top,
  left,
}: Readonly<{
  series: readonly ChartSeries[];
  index: number;
  /** The series the axis dates from, so the card never reads a shorter one. */
  dateSource: ChartSeries | null;
  top: number;
  left: number;
}>) {
  const comparisonDate = dateSource?.comparison?.[index]?.date ?? null;
  return (
    <ChartTip title={dayTitle(index, dateSource?.selected[index]?.date)} top={top} left={left}>
      {series.map((entry) => (
        <ChartTipRow
          key={entry.key}
          tone={entry.tone}
          name={entry.label}
          value={tipValue(entry, index)}
        />
      ))}
      {comparisonDate ? (
        <p className={textRole('caption')}>Comparison day · {comparisonDate}</p>
      ) : null}
    </ChartTip>
  );
}

function PlotDrawing({
  lines,
  scale,
  width,
  columnCount,
  dates,
  active,
}: Readonly<{
  lines: readonly PlotLine[];
  scale: TrendScale;
  width: number;
  columnCount: number;
  dates: readonly PerformanceChartPoint[];
  active: number | null;
}>) {
  const bottom = scale.padTop + scale.plotHeight;
  return (
    <svg
      aria-hidden
      focusable="false"
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className="block overflow-visible"
    >
      {scale.ticks.map((tick) => {
        const y = Math.round(scale.y(tick)) + 0.5;
        return (
          <line
            key={`grid-${tick}`}
            x1={scale.padLeft}
            x2={scale.right}
            y1={y}
            y2={y}
            shapeRendering="crispEdges"
            className="stroke-chart-grid"
          />
        );
      })}
      {computeTickIndices(columnCount, 6).map((index) => {
        // No date means the selected window does not reach this position (a
        // comparison runs longer): an unlabelled tick is honest.
        const date = dates[index]?.date;
        return date ? (
          <text
            key={`date-${index}`}
            x={scale.x(index)}
            y={HEIGHT - 8}
            textAnchor="middle"
            className={CHART_AXIS_TEXT}
          >
            {formatShortDate(date)}
          </text>
        ) : null;
      })}
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
      {[...lines].reverse().map((line) => (
        <Fragment key={line.key}>
          {line.comparison ? (
            <PlotLinePath heights={line.comparison} tone={line.tone} scale={scale} comparison />
          ) : null}
          <PlotLinePath heights={line.selected} tone={line.tone} scale={scale} />
        </Fragment>
      ))}
      {active === null ? null : <ActiveDots lines={lines} scale={scale} index={active} />}
    </svg>
  );
}

function PlotLinePath({
  heights,
  tone,
  scale,
  comparison = false,
}: Readonly<{ heights: Heights; tone: ChartTone; scale: TrendScale; comparison?: boolean }>) {
  const points = linePoints(heights, [], scale);
  return (
    <g data-performance-line={comparison ? 'comparison' : 'selected'}>
      <path
        d={chartPath(points)}
        fill="none"
        strokeWidth={2}
        strokeDasharray={comparison ? COMPARISON_DASH : CHART_DASH[tone]}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={CHART_STROKE[tone]}
      />
      {isolatedPoints(points).map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2.5} className={CHART_FILL[tone]} />
      ))}
    </g>
  );
}

/** A dot on every measured value at the crosshair; a comparison's is the smaller. */
function ActiveDots({
  lines,
  scale,
  index,
}: Readonly<{ lines: readonly PlotLine[]; scale: TrendScale; index: number }>) {
  const x = scale.x(index);
  return lines.flatMap((line) => {
    const selected = line.selected[index];
    const comparison = line.comparison?.[index];
    return [
      typeof comparison === 'number' ? (
        <circle
          key={`${line.key}-comparison`}
          cx={x}
          cy={scale.y(comparison)}
          r={3}
          strokeWidth={2}
          className={cn('stroke-surface', CHART_FILL[line.tone])}
        />
      ) : null,
      typeof selected === 'number' ? (
        <circle
          key={line.key}
          cx={x}
          cy={scale.y(selected)}
          r={4}
          strokeWidth={2}
          className={cn('stroke-surface', CHART_FILL[line.tone])}
        />
      ) : null,
    ];
  });
}

/** Every value, each comparison value and each comparison date, for a reader who cannot see the plot. */
function PerformanceTable({
  label,
  series,
  columnCount,
  dateSource,
}: Readonly<{
  label: string;
  series: readonly ChartSeries[];
  columnCount: number;
  dateSource: ChartSeries | null;
}>) {
  const columns = Array.from({ length: columnCount }, (_, index) => index);
  const comparisonDates = dateSource?.comparison;
  return (
    <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            {columns.map((index) => (
              <th key={index} scope="col">
                {dayTitle(index, dateSource?.selected[index]?.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => (
            <Fragment key={entry.key}>
              <ValueRow
                name={entry.label}
                metric={entry.key}
                points={entry.selected}
                columns={columns}
              />
              {entry.comparison ? (
                <ValueRow
                  name={`${entry.label} (comparison)`}
                  metric={entry.key}
                  points={entry.comparison}
                  columns={columns}
                />
              ) : null}
            </Fragment>
          ))}
          {comparisonDates ? (
            <tr>
              <th scope="row">Comparison day</th>
              {columns.map((index) => (
                <td key={index}>{comparisonDates[index]?.date ?? ''}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ValueRow({
  name,
  metric,
  points,
  columns,
}: Readonly<{
  name: string;
  metric: PerformanceMetricKey;
  points: readonly PerformanceChartPoint[];
  columns: readonly number[];
}>) {
  return (
    <tr>
      <th scope="row">{name}</th>
      {columns.map((index) => (
        <td key={index}>{formatMetric(metric, points[index]?.value ?? null)}</td>
      ))}
    </tr>
  );
}
