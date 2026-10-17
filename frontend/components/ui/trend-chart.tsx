import { ChartAxes } from '@/components/ui/chart-axes';
import { cn } from '@/lib/utils';
import { isAppRoute, type AppRoute } from '@/lib/navigation/app-route';

export type TrendPoint = {
  label: string;
  /**
   * The short form for an x-axis tick, when `label` is too long to sit under
   * the plot. A point's `label` describes it in full ("10 Sep · 38%") because
   * that is what a reader hovers to see; an axis tick has room for the date.
   */
  axisLabel?: string;
  /** Null is unavailable and renders as a gap, never as zero. */
  value: number | null;
  versionChange?: { note: string } | null;
  timestamp?: number;
  breakBefore?: boolean;
  href?: AppRoute;
};

/**
 * A second, third, … line drawn behind the primary series.
 *
 * Comparison series carry no marks, links or version markers: they exist to
 * give the primary line something to be read against, and every affordance they
 * borrowed from it would compete with it.
 */
export type TrendSeries = {
  label: string;
  values: readonly (number | null)[];
  /** Stroke class from the categorical chart tokens, e.g. `stroke-chart-2`. */
  strokeClass: string;
};

/**
 * Something that happened at a moment, drawn as a marker across the plot.
 *
 * Placed on the time axis, so it is drawn only when every point carries a
 * timestamp and the event falls inside their span; a reader gets the full
 * list beside the chart either way. A marker says when, never what it caused.
 */
export type TrendEvent = {
  key: string;
  timestamp: number;
  label: string;
};

const toLinePath = (segment: { x: number; y: number }[]) =>
  segment
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');

const valueText = (value: number | null) => (value === null ? 'unavailable' : `${value}`);

/** Token-only chart for cross-run visibility trends. */
/**
 * One plotted point, wrapped in a link only when it HAS somewhere to go.
 *
 * A point whose measurement carries no evidence route was still wrapped in an
 * `<a>` carrying its label; an anchor with no `href` announces as a link that
 * leads nowhere, which is worse than the plain mark it should have been.
 */
function TrendPointMark({ x, y, point }: Readonly<{ x: number; y: number; point: TrendPoint }>) {
  const description = `${point.label}: ${point.value}`;
  const mark = (
    <circle cx={x} cy={y} r={2.5} className="fill-chart-1" aria-label={description}>
      <title>{description}</title>
    </circle>
  );
  if (!point.href || !isAppRoute(point.href)) return mark;
  return (
    <a href={point.href} aria-label={description}>
      {mark}
    </a>
  );
}

type PlottedPoint = { x: number; y: number | null; breakBefore?: boolean };

/**
 * The drawn runs of line, split wherever the series stops being continuous.
 *
 * A gap is either a point with no value or one explicitly marked as measured
 * under different conditions — joining across either would draw a change that
 * was never observed. A run of one point has no line to draw, only its mark.
 */
function lineSegmentsOf(points: readonly PlottedPoint[]): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const close = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (const point of points) {
    if (point.breakBefore) close();
    if (point.y === null) close();
    else current.push({ x: point.x, y: point.y });
  }
  close();
  return segments.filter((segment) => segment.length > 1);
}

/** What the chart says to a reader who cannot see it. */
function chartDescription(data: readonly TrendPoint[], label?: string): string {
  const [first] = data;
  const last = data.at(-1);
  let summary = 'No trend data';
  if (first && last) {
    summary =
      data.length === 1
        ? `Single point ${first.label} (${valueText(first.value)})`
        : `Trend from ${first.label} (${valueText(first.value)}) ` +
          `to ${last.label} (${valueText(last.value)})`;
  }
  const gapNote = data.some((entry) => entry.value === null)
    ? ' Some points are unavailable and shown as gaps.'
    : '';
  return label ? `${label}: ${summary}${gapNote}` : `${summary}${gapNote}`;
}

/** Gutters exist only to hold text, so each is sized by the text it holds. */
/** A gutter carrying an axis title needs the wider of the two sizes. */
function titledGutter(title: string | undefined, titled: number, bare: number): number {
  return title ? titled : bare;
}

function plotBox({
  width,
  height,
  xAxisLabel,
  yAxisLabel,
}: Readonly<{ width: number; height: number; xAxisLabel?: string; yAxisLabel?: string }>) {
  const padding = 8;
  const axes = Boolean(xAxisLabel || yAxisLabel);
  // No axis title means no rotated-label column, and no axes at all means the
  // chart keeps the symmetric padding it has always drawn with — which is what
  // makes this change invisible to every caller that names no axis.
  //
  // The y gutter holds TWO pieces of text side by side: the rotated axis title
  // against the edge, and the tick values right-aligned against the plot. At 30
  // units they collided — a tick reading "100%" is about 22 units wide, so it
  // ran back to x≈3 and straight through the title sitting at x≈9. The gutter
  // is sized for both.
  const gutterLeft = axes ? titledGutter(yAxisLabel, 42, 22) : padding;
  const gutterBottom = axes ? titledGutter(xAxisLabel, 24, 14) : padding;
  return {
    padding,
    gutterLeft,
    innerWidth: width - gutterLeft - padding,
    innerHeight: height - padding - gutterBottom,
  };
}

/**
 * Floor, midpoint and ceiling — not a dense grid.
 *
 * Those three are what a reader needs to place a point; every line beyond them
 * competes with the series for attention.
 */
function yAxisTicks(
  padding: number,
  innerHeight: number,
  domainMax: number,
  formatTick: (value: number) => string,
) {
  return [0, 0.5, 1].map((fraction) => ({
    at: padding + innerHeight * (1 - fraction),
    text: formatTick(domainMax * fraction),
  }));
}

/** First, middle and last, anchored so the outer two stay inside the plot. */
function xAxisTicks(points: readonly PlottedEntry[]) {
  if (!points.length) return [];
  const indexes =
    points.length > 2
      ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
      : [0, points.length - 1];
  const ticked = [...new Set(indexes)].flatMap((index) => points[index] ?? []);
  return ticked.map((point, order) => ({
    at: point.x,
    text: point.entry.axisLabel ?? point.entry.label,
    // A lone tick sits over its point; a set is pulled inward at both ends.
    anchor: xTickAnchor(order, ticked.length),
  }));
}

function xTickAnchor(order: number, total: number): 'start' | 'middle' | 'end' {
  if (total === 1) return 'middle';
  if (order === 0) return 'start';
  return order === total - 1 ? 'end' : 'middle';
}

/** A primary-series point in plot coordinates, with the entry it draws. */
type PlottedEntry = PlottedPoint & { entry: TrendPoint; key: string };

/**
 * Project each point into plot coordinates; a null value stays a gap.
 *
 * Each point also gets a stable React key, because labels are NOT identities.
 * A series can hold several points that format to the same label (two runs on
 * the same day both render "1 Aug"), which made React collapse them onto one
 * key. EVERY point carries its occurrence suffix, including the first:
 * suffixing only repeats left the bare label in play, so a series holding both
 * "1 Aug" and a literal "1 Aug#1" collided on the second "1 Aug".
 */
function plotPoints(
  data: readonly TrendPoint[],
  box: Readonly<{
    padding: number;
    gutterLeft: number;
    innerWidth: number;
    innerHeight: number;
    domainMax: number;
    time: TimeAxis | null;
  }>,
): PlottedEntry[] {
  const { padding, gutterLeft, innerWidth, innerHeight, domainMax, time } = box;
  const xOf = xScale(data, time, gutterLeft, innerWidth);
  const seenCount = new Map<string, number>();
  return data.map((entry, index) => {
    const seen = seenCount.get(entry.label) ?? 0;
    seenCount.set(entry.label, seen + 1);
    return {
      entry,
      key: `${entry.label}#${seen}`,
      x: xOf(entry, index),
      breakBefore: entry.breakBefore,
      y:
        entry.value === null
          ? null
          : padding + innerHeight * (1 - clampTo(entry.value, domainMax) / domainMax),
    };
  });
}

const clampTo = (value: number, domainMax: number) => Math.max(0, Math.min(domainMax, value));

type TimeAxis = { first: number; span: number };

/** The time axis, when every point carries a timestamp and they span time. */
function timeAxis(data: readonly TrendPoint[]): TimeAxis | null {
  const stamps = data.flatMap((entry) =>
    entry.timestamp !== undefined && Number.isFinite(entry.timestamp) ? [entry.timestamp] : [],
  );
  if (stamps.length !== data.length || stamps.length < 2) return null;
  const first = Math.min(...stamps);
  const span = Math.max(...stamps) - first;
  return span > 0 ? { first, span } : null;
}

/**
 * Real time on the x axis when every point carries a timestamp.
 *
 * Falling back to even spacing would draw a run three months late as though it
 * followed the previous one immediately.
 */
function xScale(
  data: readonly TrendPoint[],
  time: TimeAxis | null,
  gutterLeft: number,
  innerWidth: number,
): (entry: TrendPoint, index: number) => number {
  if (time) {
    return (entry) =>
      gutterLeft + (((entry.timestamp ?? time.first) - time.first) / time.span) * innerWidth;
  }
  if (data.length < 2) return () => gutterLeft + innerWidth / 2;
  const stepX = innerWidth / (data.length - 1);
  return (_entry, index) => gutterLeft + index * stepX;
}

/** Events inside the plotted time span, in plot coordinates. */
function plotEvents(
  time: TimeAxis | null,
  events: readonly TrendEvent[],
  gutterLeft: number,
  innerWidth: number,
) {
  if (!time) return [];
  return events.flatMap((event) => {
    const offset = event.timestamp - time.first;
    if (!Number.isFinite(offset) || offset < 0 || offset > time.span) return [];
    return [{ event, x: gutterLeft + (offset / time.span) * innerWidth }];
  });
}

export function TrendChart({
  data,
  series = [],
  events = [],
  width = 320,
  height = 96,
  label,
  className,
  domainMax = 100,
  xAxisLabel,
  yAxisLabel,
  formatTick = (value) => `${Math.round(value)}`,
}: Readonly<{
  data: TrendPoint[];
  /** Comparison lines sharing this chart's x positions and scale. */
  series?: readonly TrendSeries[];
  /** Moments marked across the plot, such as work declared live. */
  events?: readonly TrendEvent[];
  width?: number;
  height?: number;
  label?: string;
  className?: string;
  domainMax?: number;
  /** Naming either axis draws both, with ticks and gridlines. */
  xAxisLabel?: string;
  yAxisLabel?: string;
  /** Renders a y-axis tick value — `42` as `42%`, `1.2k`, and so on. */
  formatTick?: (value: number) => string;
}>) {
  const axes = Boolean(xAxisLabel || yAxisLabel);
  const { padding, gutterLeft, innerWidth, innerHeight } = plotBox({
    width,
    height,
    xAxisLabel,
    yAxisLabel,
  });
  const effectiveDomainMax = domainMax > 0 ? domainMax : 100;
  const time = timeAxis(data);
  const points = plotPoints(data, {
    time,
    padding,
    gutterLeft,
    innerWidth,
    innerHeight,
    domainMax: effectiveDomainMax,
  });

  const yTicks = axes ? yAxisTicks(padding, innerHeight, effectiveDomainMax, formatTick) : [];
  const xTicks = axes ? xAxisTicks(points) : [];

  const lineSegments = lineSegmentsOf(points);
  const markers = plotEvents(time, events, gutterLeft, innerWidth);
  // Comparison lines reuse the primary series' x positions, so the two are read
  // against one scale rather than two charts drawn side by side. A value the
  // series never measured stays a gap here exactly as it does above.
  const comparisons = series.map((entry) => ({
    entry,
    segments: lineSegmentsOf(
      points.map((point, index) => {
        const value = entry.values[index];
        return {
          x: point.x,
          breakBefore: point.breakBefore,
          y:
            value === null || value === undefined
              ? null
              : padding +
                innerHeight * (1 - clampTo(value, effectiveDomainMax) / effectiveDomainMax),
        };
      }),
    ),
  }));
  // Comparison lines carry no marks, so without naming them here a screen
  // reader is told about one series on a chart that draws several.
  const described = series.length
    ? `${chartDescription(data, label)} Compared with ${series
        .map((entry) => entry.label)
        .join(', ')}.`
    : chartDescription(data, label);
  // The axis layer is `aria-hidden`, so without this a screen-reader user gets
  // the shape and none of the scale -- strictly less than the sighted reader,
  // on the very chart the axes were added to make readable.
  const byAxis = xAxisLabel ? `, by ${xAxisLabel.toLowerCase()}` : '';
  const scaleNote = axes
    ? ` ${yAxisLabel ?? 'Value'} from ${formatTick(0)} to ${formatTick(effectiveDomainMax)}${byAxis}.`
    : '';
  const eventNote = markers.length
    ? ` Marked: ${markers.map(({ event }) => event.label).join('; ')}.`
    : '';
  const ariaLabel = `${described}${scaleNote}${eventNote}`;

  return (
    <svg
      role={data.some((entry) => entry.href) ? 'group' : 'img'} // NOSONAR -- an <svg> chart has no native grouping tag; fieldset/details cannot wrap SVG content
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
    >
      <title>{ariaLabel}</title>
      {axes ? (
        <ChartAxes
          x={gutterLeft}
          y={padding}
          innerWidth={innerWidth}
          innerHeight={innerHeight}
          ticks={yTicks}
          xTicks={xTicks}
          xAxisLabel={xAxisLabel}
          yAxisLabel={yAxisLabel}
          height={height}
        />
      ) : null}
      {comparisons.map(({ entry, segments }) =>
        segments.map((segment, index) => (
          <path
            key={`series-${entry.label}-${index}`}
            d={toLinePath(segment)}
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(entry.strokeClass, 'opacity-70')}
            aria-hidden
          >
            <title>{entry.label}</title>
          </path>
        )),
      )}
      {lineSegments.map((segment) => (
        <path
          // Runs never overlap, so each one's starting x identifies it.
          key={`line-${segment[0]?.x}`}
          d={toLinePath(segment)}
          fill="none"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-chart-1"
        />
      ))}
      {markers.map(({ event, x }) => (
        <g key={`event-${event.key}`} data-event-marker="">
          <line
            x1={x}
            y1={padding}
            x2={x}
            y2={padding + innerHeight}
            strokeWidth={1}
            strokeDasharray="2 3"
            className="stroke-chart-6 opacity-70"
            aria-hidden
          />
          <rect
            x={x - 3}
            y={padding + innerHeight - 3}
            width={6}
            height={6}
            className="fill-chart-6"
          >
            <title>{event.label}</title>
          </rect>
        </g>
      ))}
      {points.map((point) =>
        point.entry.versionChange ? (
          <g key={`marker-${point.key}`} data-version-marker="">
            <line
              x1={point.x}
              y1={padding}
              x2={point.x}
              y2={padding + innerHeight}
              strokeWidth={1}
              strokeDasharray="4 3"
              className="stroke-warning opacity-60"
              aria-hidden
            />
            <circle cx={point.x} cy={padding} r={3} className="fill-warning">
              <title>{`Version change at ${point.entry.label}: ${point.entry.versionChange.note}`}</title>
            </circle>
          </g>
        ) : null,
      )}
      {points.map((point) =>
        point.y === null ? null : (
          <TrendPointMark key={`point-${point.key}`} x={point.x} y={point.y} point={point.entry} />
        ),
      )}
    </svg>
  );
}
