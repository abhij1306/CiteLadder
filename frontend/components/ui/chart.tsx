'use client';

import type { ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';

import { dataFillClass, type DataTone } from '@/components/ui/data-tone';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The frame every product chart draws inside.
 *
 * Charts used to be hand-rolled SVG with a fixed viewBox stretched to fit,
 * which meant the drawing was scaled unevenly: `preserveAspectRatio="none"`
 * over a 640-unit box in a 900px column squashed every glyph horizontally
 * while leaving its height alone, and the gutters — sized in viewBox units for
 * a width nobody was rendering at — put the rotated axis title through the
 * tick values beside it. A real layout engine sizes to the container it is
 * actually given, so neither failure is expressible here.
 *
 * `config` names the series once. Its `color` is a CSS variable from the
 * chart ladder in `globals.css`, never a literal: the tokens are the only
 * place a series colour is decided, and `check:policy` enforces that.
 */
export type ChartConfig = Record<string, { label: string; color: string }>;

/**
 * The plot heights a chart may take, as roles rather than pixel values:
 * charts had settled at 200, 220, 240, 280 and 304px, so two trend charts side
 * by side never shared a baseline.
 *
 *   - `sm` (160px) — a compact chart inside a card beside other content.
 *   - `md` (240px) — the default trend or bar chart.
 *   - `lg` (320px) — the page's primary chart.
 */
const chartHeightClasses = {
  sm: 'h-[var(--chart-height-sm)]',
  md: 'h-[var(--chart-height-md)]',
  lg: 'h-[var(--chart-height-lg)]',
} as const;

export type ChartHeight = keyof typeof chartHeightClasses;

/** `--color-<key>` for every series, so Recharts props can name the token. */
function seriesVariables(config: ChartConfig): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).map(([key, entry]) => [`--color-${key}`, entry.color]),
  );
}

export function ChartContainer({
  config,
  children,
  className,
  size = 'md',
  description,
}: Readonly<{
  config: ChartConfig;
  /** One Recharts chart element. */
  children: ReactElement;
  className?: string;
  /** The plot's height role. */
  size?: ChartHeight;
  /**
   * What the chart says to a reader who cannot see it.
   *
   * Required in practice: the drawing is `aria-hidden` because a screen
   * reader handed a tree of `<path>` elements learns nothing from it, so this
   * sentence is the only reading such a reader gets.
   */
  description: string;
}>) {
  return (
    <div className={cn('w-full', className)} style={seriesVariables(config)}>
      <p className="sr-only">{description}</p>
      <div aria-hidden className={chartHeightClasses[size]}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Exactly one paint: two would stack, and none renders an invisible swatch. */
type SwatchPaint =
  | { tone: DataTone; color?: never; fillClass?: never }
  | {
      /** A token value such as `var(--color-chart-2)`, for `ChartConfig` series. */
      color: string;
      tone?: never;
      fillClass?: never;
    }
  | {
      /** A fill utility the caller already resolved. */
      fillClass: string;
      tone?: never;
      color?: never;
    };

/**
 * The key beside a legend entry: a dot (a series or point) or a short rule (a
 * line). Its colour is a `DataTone` — a series index for categorical identity
 * or an outcome family for a state — or, inside a Recharts frame, the
 * series' token `color` from `ChartConfig`. Decorative: the entry's text is
 * what names the series.
 */
export function LegendSwatch({
  tone,
  color,
  fillClass,
  shape = 'dot',
  className,
}: Readonly<SwatchPaint & { shape?: 'dot' | 'line'; className?: string }>) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-full',
        shape === 'dot' ? 'size-2' : 'h-0.5 w-4',
        tone ? dataFillClass(tone) : fillClass,
        className,
      )}
      style={color ? { background: color } : undefined}
    />
  );
}

/** Axis defaults: no tick marks, one hairline, and room for the labels. */
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  tick: { fontSize: 11, className: 'fill-muted' },
} as const;

/**
 * A legend whose entries are buttons, not swatches.
 *
 * Reading a specific value off a five-line chart is the legend's job: hovering
 * or focusing an entry brings its line forward and dims the rest. Hover and
 * focus do the same thing, so the comparison is available without a pointer.
 */
export function ChartLegend({
  config,
  active,
  onActivate,
}: Readonly<{
  config: ChartConfig;
  active: string | null;
  onActivate: (key: string | null) => void;
}>) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {Object.entries(config).map(([key, entry]) => (
        <li key={key}>
          <button
            type="button"
            onMouseEnter={() => onActivate(key)}
            onMouseLeave={() => onActivate(null)}
            onFocus={() => onActivate(key)}
            onBlur={() => onActivate(null)}
            className={cn(
              'focus-ring type-caption flex items-center gap-2 transition-opacity',
              active && active !== key ? 'opacity-45' : 'opacity-100',
            )}
          >
            <LegendSwatch color={entry.color} />
            <span className={textRole('caption', 'max-w-[18ch] truncate')}>{entry.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one chart hover-card surface: inverse ink on the inverse fill, so every
 * chart's tooltip reads as the same object. Its contents use `text-on-inverse`.
 */
export function ChartTooltipPanel({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div
      className={cn(
        'tooltip-panel bg-surface-inverse text-on-inverse shadow-overlay rounded-[var(--radius-card)] px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The shared hover card: the bucket, then every series that has a value. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatValue,
}: Readonly<{
  active?: boolean;
  payload?: readonly { name?: string; dataKey?: string; value?: number; color?: string }[];
  label?: ReactNode;
  formatValue: (value: number) => string;
}>) {
  if (!active || !payload?.length) return null;
  // A series with no measurement in this bucket is ABSENT from the card, not
  // listed at zero: the gap in the line and the gap here say the same thing.
  const measured = payload.filter((entry) => typeof entry.value === 'number');
  if (!measured.length) return null;
  return (
    <ChartTooltipPanel>
      <p className="type-badge">{label}</p>
      <ul className="grid gap-0.5">
        {measured.map((entry) => (
          <li
            key={entry.dataKey ?? entry.name}
            className="type-caption text-on-inverse flex items-center gap-2"
          >
            {entry.color ? <LegendSwatch color={entry.color} /> : null}
            <span className="max-w-[16ch] truncate">{entry.name}</span>
            <span className="ml-auto tabular-nums">{formatValue(entry.value as number)}</span>
          </li>
        ))}
      </ul>
    </ChartTooltipPanel>
  );
}
