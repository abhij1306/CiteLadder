import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { FLOAT_FACE } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The chart kit every product chart draws with: plain SVG and the chart
 * tokens, no chart library.
 *
 * A series takes its colour from its POSITION, never from what it is:
 *   1 your brand (`data-1`), 2 the leader (`data-2`), 3 the next (`data-3`),
 *   4 an item flagged `other` (`data-other`, always textured — dashed as a
 *   line, hatched as an area — because it sits close to `data-3`), and
 *   5 a further named series (`data-3`, dotted).
 */
export type ChartTone = 1 | 2 | 3 | 4 | 5;

export function chartTone(item: Readonly<{ other?: boolean }>, index: number): ChartTone {
  if (item.other) return 4;
  return index >= 3 ? 5 : ((index + 1) as ChartTone);
}

export const CHART_STROKE: Record<ChartTone, string> = {
  1: 'stroke-data-1',
  2: 'stroke-data-2',
  3: 'stroke-data-3',
  4: 'stroke-data-other',
  5: 'stroke-data-3',
};

export const CHART_FILL: Record<ChartTone, string> = {
  1: 'bg-data-1 fill-data-1',
  2: 'bg-data-2 fill-data-2',
  3: 'bg-data-3 fill-data-3',
  4: 'bg-data-other fill-data-other',
  5: 'bg-data-3 fill-data-3',
};

/** Axis text inside a chart's SVG: 12px mono figures in `ink-muted`. */
export const CHART_AXIS_TEXT = 'fill-ink-muted text-caption font-mono tabular-nums';

/** The plot's focusable box, read with the arrow keys; the focus ring follows its corners. */
export const CHART_PLOT_FRAME = 'focus-ring relative w-full rounded-sm';

/** A line's dash: Other is dashed, a fifth series dotted, the rest solid. */
export const CHART_DASH: Record<ChartTone, string | undefined> = {
  1: undefined,
  2: undefined,
  3: undefined,
  4: '4 3',
  5: '0.01 4.5',
};

/** One share of a whole, to one decimal: `12.5%`. A zero total is `0%`. */
export function chartPercent(value: number, total: number): string {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

/** Whole-number counts in the product's grouping: `1,240`. */
export const formatChartCount = (value: number) => value.toLocaleString('en-US');

/**
 * Round tick values covering `min`–`max` in about `count` steps of 1, 2, 2.5
 * or 5 times a power of ten, so an axis reads 0, 25, 50 rather than 0, 23, 46.
 */
export function chartTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = niceStep(raw / magnitude) * magnitude;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

function niceStep(normalised: number): number {
  return [1, 2, 2.5, 5].find((step) => normalised <= step) ?? 10;
}

/** An SVG path through the points; a `null` lifts the pen, so a gap stays a gap. */
export function chartPath(points: readonly (readonly [number, number] | null)[]): string {
  let path = '';
  let pen = false;
  for (const point of points) {
    if (!point) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
    pen = true;
  }
  return path;
}

/**
 * The plot's width in CSS pixels, measured, so the viewBox is the box: lines
 * stretch and axis text stays 12px at every width. `fallback` holds until the
 * first measurement (and in environments that cannot measure).
 */
export function useChartWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The Other texture: `data-other` stripes on the `chart-grid` ground. */
export function ChartHatchPattern({ id }: Readonly<{ id: string }>) {
  return (
    <pattern
      id={id}
      width={4}
      height={4}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect width={4} height={4} className="fill-chart-grid" />
      <line x1={1} y1={0} x2={1} y2={4} strokeWidth={2} className="stroke-data-other" />
    </pattern>
  );
}

/** A hatched fill for an HTML box (a bar, a swatch) standing for Other. */
export function ChartHatch() {
  const id = `chart-hatch-${useId().replaceAll(':', '')}`;
  return (
    <svg aria-hidden focusable="false" className="block size-full">
      <defs>
        <ChartHatchPattern id={id} />
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * The key beside a series' name: an 8px square for an area, a 12 × 3 rule for
 * a line. Decorative: the name beside it says which series it is.
 */
export function ChartSwatch({ tone, line = false }: Readonly<{ tone: ChartTone; line?: boolean }>) {
  if (line && (tone === 4 || tone === 5)) {
    return (
      <svg
        aria-hidden
        focusable="false"
        width={12}
        height={3}
        viewBox="0 0 12 3"
        className="shrink-0"
      >
        <line
          x1={0.5}
          y1={1.5}
          x2={11.5}
          y2={1.5}
          strokeWidth={3}
          strokeLinecap={tone === 5 ? 'round' : undefined}
          strokeDasharray={tone === 5 ? '0.01 3' : '3 1.5'}
          className={CHART_STROKE[tone]}
        />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 overflow-hidden',
        line ? 'h-[3px] w-3 rounded-2xs' : 'rounded-2xs size-2',
        tone === 4 ? undefined : CHART_FILL[tone],
      )}
    >
      {tone === 4 ? <ChartHatch /> : null}
    </span>
  );
}

export type ChartLegendEntry = Readonly<{ name: string; tone: ChartTone; value?: string }>;

/**
 * A chart's key: one wrapping row of swatch, name and (for a trend) the latest
 * value. Hidden from assistive technology: the chart's own table names every
 * series and value.
 */
export function ChartLegend({
  entries,
  line = false,
  markerLabel,
  compact = false,
}: Readonly<{
  entries: readonly ChartLegendEntry[];
  line?: boolean;
  /** The key for event markers drawn across the plot (a dashed `line-control` rule). */
  markerLabel?: string;
  /** Caption-size names and values instead of `body-sm`. */
  compact?: boolean;
}>) {
  const item = cn(
    compact ? 'text-caption' : 'text-body-sm',
    // Capped, so three long names still share a row instead of taking one each.
    'inline-flex max-w-[min(100%,20rem)] min-w-0 items-center gap-2 whitespace-nowrap',
  );
  return (
    <ul aria-hidden className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
      {entries.map((entry) => (
        <li key={entry.name} className={item}>
          <ChartSwatch tone={entry.tone} line={line} />
          {/* A name wider than the card (a page's URL) is cut, whole in its title. */}
          <span className="text-ink-secondary min-w-0 truncate" title={entry.name}>
            {entry.name}
          </span>
          {entry.value === undefined ? null : (
            <span className="text-ink shrink-0 tabular-nums">{entry.value}</span>
          )}
        </li>
      ))}
      {markerLabel ? (
        <li className={item}>
          <svg width={12} height={3} viewBox="0 0 12 3" className="shrink-0">
            <line
              x1={0}
              y1={1.5}
              x2={12}
              y2={1.5}
              strokeWidth={2}
              strokeDasharray="2 3"
              className="stroke-line-control"
            />
          </svg>
          <span className="text-ink-secondary">{markerLabel}</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The hover card every chart shares: the floating face (`surface`, 1px `line`
 * border, `shadow-float`) at the floating radius, a mono caption naming the
 * point, then one row per series.
 */
export function ChartTip({
  title,
  left,
  top,
  children,
}: Readonly<{ title: string; left: number; top: number; children: ReactNode }>) {
  return (
    <div
      aria-hidden
      className={cn(
        FLOAT_FACE,
        'pointer-events-none absolute z-20 flex w-54 flex-col gap-1 rounded-lg p-3',
      )}
      style={{ left, top }}
    >
      <p className="text-caption text-ink-muted mb-1 font-mono">{title}</p>
      {children}
    </div>
  );
}

export function ChartTipRow({
  tone,
  name,
  value,
  compact = false,
}: Readonly<{ tone: ChartTone; name: string; value: string; compact?: boolean }>) {
  return (
    <div className={cn(compact ? 'text-caption' : 'text-body-sm', 'flex items-center gap-2')}>
      <ChartSwatch tone={tone} line />
      <span className="text-ink-secondary min-w-0 flex-1 truncate">{name}</span>
      <span className="text-ink tabular-nums">{value}</span>
    </div>
  );
}

/**
 * The plot heights a chart may take, as roles: `sm` 160 (a compact chart
 * beside other content), `md` 240 (the default), `lg` 320 (a page's primary
 * chart).
 */
const chartFrameClasses = {
  sm: 'min-h-[var(--chart-height-sm)]',
  md: 'min-h-[var(--chart-height-md)]',
  lg: 'min-h-[var(--chart-height-lg)]',
} as const;

export type ChartHeight = keyof typeof chartFrameClasses;

/**
 * The roles in pixels, for a chart that draws its plot to a measured box. The
 * same values as the `--chart-height-*` tokens in `apps/app/src/globals.css`.
 */
export const CHART_HEIGHT_PX = { sm: 160, md: 240, lg: 320 } as const satisfies Record<
  ChartHeight,
  number
>;

/**
 * The box a chart and every state standing in for it share: the chart's
 * height role as a floor, so loading, a read error or an empty selection
 * occupy the plot's footprint and nothing under the card moves.
 */
export function ChartFrame({
  height,
  children,
}: Readonly<{ height: ChartHeight; children: ReactNode }>) {
  return <div className={cn('grid min-w-0 *:min-w-0', chartFrameClasses[height])}>{children}</div>;
}
