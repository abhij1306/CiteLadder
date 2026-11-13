import { chartTicks } from '@/components/ui/chart';

/** The fixed insets around the plot: 24 right, 10 above, 30 under it for the dates. */
const PAD_RIGHT = 24;
const PAD_TOP = 10;
const PAD_BOTTOM = 30;
/** The least room between two date labels on the x axis. */
const LABEL_SPACING = 64;
/**
 * The first and last points sit this far inside the plot's edges, so their
 * dates centre under them without reaching the card's edge, and the line
 * ends clear of the axis ticks and the right edge.
 */
const X_INSET = 32;

export type TrendScale = Readonly<{
  padLeft: number;
  padTop: number;
  plotWidth: number;
  plotHeight: number;
  right: number;
  ticks: readonly number[];
  x: (index: number) => number;
  /** A position along the time axis, 0 at the first point and 1 at the last. */
  xAt: (fraction: number) => number;
  y: (value: number) => number;
  /** The index whose point is nearest a horizontal position. */
  nearest: (offsetX: number) => number;
}>;

/** The y domain: zero (or the lowest value) to the ceiling, unless the caller fixes either end. */
function domainOf(
  lines: readonly (readonly (number | null)[])[],
  yMin: number | undefined,
  yMax: number | undefined,
) {
  const values = lines.flatMap((values) =>
    values.filter((value): value is number => value !== null),
  );
  const low = yMin ?? Math.min(0, ...values);
  const high = yMax ?? Math.max(1, ...values);
  const ticks = chartTicks(low, high, 5);
  const top = yMax ?? ticks.at(-1) ?? high;
  return { ticks: ticks.filter((tick) => tick <= top + 1e-9), bottom: ticks[0] ?? low, top };
}

/**
 * Real time on the x axis when every point carries a timestamp and they span
 * time: falling back to even spacing would draw a run three months late as
 * though it followed the previous one immediately.
 */
function timeFractions(timestamps: readonly (number | undefined)[]): number[] | null {
  const stamps = timestamps.filter(
    (stamp): stamp is number => stamp !== undefined && Number.isFinite(stamp),
  );
  if (stamps.length !== timestamps.length || stamps.length < 2) return null;
  const first = Math.min(...stamps);
  const span = Math.max(...stamps) - first;
  return span > 0 ? stamps.map((stamp) => (stamp - first) / span) : null;
}

function evenFractions(count: number): number[] {
  if (count < 2) return Array.from({ length: count }, () => 0.5);
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

export function trendScale({
  width,
  height,
  lines,
  timestamps,
  yMin,
  yMax,
  tickWidth,
}: Readonly<{
  width: number;
  height: number;
  lines: readonly (readonly (number | null)[])[];
  timestamps: readonly (number | undefined)[];
  yMin?: number;
  yMax?: number;
  /** The widest tick label, in characters, which sizes the left gutter. */
  tickWidth: (ticks: readonly number[]) => number;
}>): TrendScale {
  const { ticks, bottom, top } = domainOf(lines, yMin, yMax);
  const padLeft = Math.round(tickWidth(ticks) * 7.4) + 14;
  const plotWidth = Math.max(1, width - padLeft - PAD_RIGHT);
  const plotHeight = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
  const fractions = timeFractions(timestamps) ?? evenFractions(timestamps.length);
  // A plot too narrow for both insets keeps the full width.
  const inset = plotWidth > 4 * X_INSET ? X_INSET : 0;
  const xAt = (fraction: number) => padLeft + inset + fraction * (plotWidth - 2 * inset);
  const xs = fractions.map(xAt);
  const span = top - bottom || 1;
  return {
    padLeft,
    padTop: PAD_TOP,
    plotWidth,
    plotHeight,
    right: width - PAD_RIGHT,
    ticks,
    x: (index) => xs[index] ?? xAt(0),
    xAt,
    y: (value) =>
      PAD_TOP +
      plotHeight -
      ((Math.min(top, Math.max(bottom, value)) - bottom) / span) * plotHeight,
    nearest: (offsetX) => nearestIndex(xs, offsetX),
  };
}

function nearestIndex(xs: readonly number[], offsetX: number): number {
  let best = 0;
  xs.forEach((x, index) => {
    if (Math.abs(x - offsetX) < Math.abs((xs[best] ?? 0) - offsetX)) best = index;
  });
  return best;
}

/**
 * The points that get a date under the axis: counted back from the latest,
 * each at least 64px from the one after it, so the newest date always shows.
 */
export function labelledIndexes(scale: TrendScale, count: number): number[] {
  const shown: number[] = [];
  let nextX = Number.POSITIVE_INFINITY;
  for (let index = count - 1; index >= 0; index -= 1) {
    const x = scale.x(index);
    if (nextX - x >= LABEL_SPACING) {
      shown.push(index);
      nextX = x;
    }
  }
  return shown.reverse();
}

/**
 * One line's points in plot coordinates. A gap is a point with no value or
 * one measured under different conditions (`breaks`): joining across either
 * would draw a change that was never observed.
 */
export function linePoints(
  values: readonly (number | null)[],
  breaks: readonly boolean[],
  scale: TrendScale,
): ([number, number] | null)[] {
  return values.flatMap((value, index) => {
    const point: [number, number] | null = value === null ? null : [scale.x(index), scale.y(value)];
    return breaks[index] && index > 0 ? [null, point] : [point];
  });
}

/**
 * The segments across each break (`breaks`) between two measured points: the
 * point before the break and the point at it. They are drawn faint and
 * dashed, so a series split by a method change still reads as one line while
 * the solid line never crosses the break. A missing value is not bridged.
 */
export function breakConnectors(
  values: readonly (number | null)[],
  breaks: readonly boolean[],
  scale: TrendScale,
): [[number, number], [number, number]][] {
  return values.flatMap((value, index) => {
    const before = values[index - 1];
    if (!breaks[index] || index === 0 || value === null || before === null || before === undefined)
      return [];
    return [
      [
        [scale.x(index - 1), scale.y(before)],
        [scale.x(index), scale.y(value)],
      ],
    ];
  });
}

/** Points with no neighbour in their run: a line of one draws nothing, so these get a dot. */
export function isolatedPoints(points: readonly ([number, number] | null)[]): [number, number][] {
  return points.flatMap((point, index) =>
    point && !points[index - 1] && !points[index + 1] ? [point] : [],
  );
}
