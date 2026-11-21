import type { TrendEvent, TrendPoint } from '@/components/ui/series-data';

export type ChartRow =
  | Readonly<{ x: number; index: number; break: false } & Record<`l${number}`, number | null>>
  | Readonly<{ x: number; index: -1; break: true }>;

export type GapRange = Readonly<{ from: number; to: number }>;

export function pointXs(data: readonly TrendPoint[]): number[] {
  const timed = data.length > 0 && data.every((point) => point.timestamp !== undefined);
  return data.map((point, index) => (timed ? (point.timestamp ?? index) : index));
}

const isTimed = (data: readonly TrendPoint[]) =>
  data.length > 0 && data.every((point) => point.timestamp !== undefined);

export function chartRows(
  data: readonly TrendPoint[],
  lines: readonly Readonly<{ values: readonly (number | null)[] }>[],
): ChartRow[] {
  const xs = pointXs(data);
  return data.flatMap((point, index) => {
    const x = xs[index] ?? index;
    const values = Object.fromEntries(
      lines.map((line, at) => [`l${at}`, line.values[index] ?? null]),
    ) as Record<`l${number}`, number | null>;
    const row: ChartRow = { x, index, break: false, ...values };
    const before = xs[index - 1];
    if (!point.breakBefore || before === undefined) return [row];
    return [{ x: (before + x) / 2, index: -1, break: true } satisfies ChartRow, row];
  });
}

export function gapRanges(values: readonly (number | null)[], xs: readonly number[]): GapRange[] {
  const step = xs.length > 1 ? ((xs.at(-1) ?? 0) - (xs[0] ?? 0)) / (xs.length - 1) : 1;
  const edge = (index: number, side: -1 | 1) => {
    const here = xs[index] ?? 0;
    const next = xs[index + side];
    return next === undefined ? here + (side * step) / 2 : (here + next) / 2;
  };
  const ranges: GapRange[] = [];
  let start: number | null = null;
  values.forEach((value, index) => {
    if (value === null && start === null) start = index;
    if (value !== null && start !== null) {
      ranges.push({ from: edge(start, -1), to: edge(index - 1, 1) });
      start = null;
    }
  });
  if (start !== null) ranges.push({ from: edge(start, -1), to: edge(values.length - 1, 1) });
  return ranges;
}

export function eventsInSpan(data: readonly TrendPoint[], events: readonly TrendEvent[]) {
  if (!isTimed(data) || data.length < 2) return [];
  const xs = pointXs(data);
  const first = Math.min(...xs);
  const last = Math.max(...xs);
  return events.filter((event) => event.timestamp >= first && event.timestamp <= last);
}

export function niceTicks({
  values,
  yMin,
  yMax,
}: Readonly<{ values: readonly number[]; yMin?: number; yMax?: number }>): number[] {
  const low = yMin ?? Math.min(0, ...values);
  const high = yMax ?? Math.max(low + 1, ...values);
  const rough = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((base) => base * power >= rough) ?? 10) * power;
  const first = yMin ?? Math.floor(low / step) * step;
  const last = yMax ?? Math.ceil(high / step) * step;
  const ticks = [first];
  for (let tick = Math.floor(first / step) * step + step; tick < last - step / 1000; tick += step)
    if (tick > first) ticks.push(Number(tick.toPrecision(12)));
  return [...ticks, last];
}

export function isolated(
  values: readonly (number | null)[],
  index: number,
  data: readonly TrendPoint[],
) {
  const joinedBefore = !data[index]?.breakBefore && (values[index - 1] ?? null) !== null;
  const joinedAfter = !data[index + 1]?.breakBefore && (values[index + 1] ?? null) !== null;
  return values[index] !== null && values[index] !== undefined && !joinedBefore && !joinedAfter;
}
