import { chartTicks } from '@/components/ui/chart';

const PAD_RIGHT = 24;
const PAD_TOP = 12;
const PAD_BOTTOM = 32;

export const onGrid = (value: number) => Math.round(value / 4) * 4;
const LABEL_SPACING = 64;
const X_INSET = 32;

export type TrendScale = Readonly<{
  padLeft: number;
  padTop: number;
  plotWidth: number;
  plotHeight: number;
  right: number;
  ticks: readonly number[];
  x: (index: number) => number;
  xAt: (fraction: number) => number;
  y: (value: number) => number;
  nearest: (offsetX: number) => number;
}>;

function domainOf(
  lines: readonly (readonly (number | null)[])[],
  yMin: number | undefined,
  yMax: number | undefined,
  tickCount: number,
  maxTicks: number,
) {
  const values = lines.flatMap((values) =>
    values.filter((value): value is number => value !== null),
  );
  const low = yMin ?? Math.min(0, ...values);
  const high = yMax ?? Math.max(1, ...values);
  let ticks = chartTicks(low, high, tickCount);
  for (let count = tickCount - 1; ticks.length > maxTicks && count >= 1; count -= 1)
    ticks = chartTicks(low, high, count);
  const top = yMax ?? ticks.at(-1) ?? high;
  return { ticks: ticks.filter((tick) => tick <= top + 1e-9), bottom: ticks[0] ?? low, top };
}

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
  padRight = PAD_RIGHT,
  tickCount = 5,
  maxTicks = Number.POSITIVE_INFINITY,
}: Readonly<{
  width: number;
  height: number;
  lines: readonly (readonly (number | null)[])[];
  timestamps: readonly (number | undefined)[];
  yMin?: number;
  yMax?: number;
  tickWidth: (ticks: readonly number[]) => number;
  padRight?: number;
  tickCount?: number;
  maxTicks?: number;
}>): TrendScale {
  const { ticks, bottom, top } = domainOf(lines, yMin, yMax, tickCount, maxTicks);
  const padLeft = onGrid(tickWidth(ticks) * 7.4 + 14);
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const plotHeight = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
  const fractions = timeFractions(timestamps) ?? evenFractions(timestamps.length);
  const inset = plotWidth > 4 * X_INSET ? X_INSET : 0;
  const xAt = (fraction: number) => padLeft + inset + fraction * (plotWidth - 2 * inset);
  const xs = fractions.map(xAt);
  const span = top - bottom || 1;
  return {
    padLeft,
    padTop: PAD_TOP,
    plotWidth,
    plotHeight,
    right: width - padRight,
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

export function isolatedPoints(points: readonly ([number, number] | null)[]): [number, number][] {
  return points.flatMap((point, index) =>
    point && !points[index - 1] && !points[index + 1] ? [point] : [],
  );
}
