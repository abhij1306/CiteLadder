'use client';

import { useId, useState } from 'react';

import {
  CHART_STROKE,
  ChartHatchPattern,
  ChartSwatch,
  chartPercent,
  chartTone,
  formatChartCount,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

export type DonutSlice = Readonly<{
  name: string;
  value: number;
  /** The merged remainder: hatched, so it never reads as another brand. */
  other?: boolean;
}>;

const SIZE = 152;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2 - 3;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTRE = SIZE / 2;
// Enough to separate neighbouring slices without eating a small one.
const GAP = 3;

/** Each slice starts where the ones before it ended, so the offsets are a running total. */
function donutArcs(slices: readonly DonutSlice[], total: number) {
  const gap = slices.length > 1 ? GAP : 0;
  let start = 0;
  return slices.map((slice) => {
    const length = (slice.value / (total || 1)) * CIRCUMFERENCE;
    const dash = Math.max(0, length - gap);
    const arc = { dash, offset: -start };
    start += length;
    return arc;
  });
}

/**
 * DonutChart — share of a whole as a 152px donut: the total in the `figure`
 * role (Geist 500) at the centre and a legend of shares and counts beside it. Colour by
 * order (your brand first in `data-1`, then `data-2`, `data-3`), Other
 * hatched; at most four slices. Hovering a slice or its legend row thickens
 * its arc and puts its share in the centre. The figure is one image whose
 * name lists every share; the legend carries the same figures as text.
 */
export function DonutChart({
  slices,
  totalLabel,
  total,
  format = formatChartCount,
  label = 'Share',
  className,
}: Readonly<{
  /** Your brand first, at most three plus Other. */
  slices: readonly DonutSlice[];
  /** The caption under the centre total, e.g. "Mentions". */
  totalLabel: string;
  /** The centre number when it is not the slices' sum. */
  total?: number;
  format?: (value: number) => string;
  /** What the shares are of, e.g. "Share of voice". */
  label?: string;
  className?: string;
}>) {
  const hatch = `donut-hatch-${useId().replaceAll(':', '')}`;
  const [active, setActive] = useState<number | null>(null);
  const shown = slices.slice(0, 4);
  const sum = shown.reduce((carry, slice) => carry + slice.value, 0);
  const arcs = donutArcs(shown, sum);
  const highlighted = active === null ? undefined : shown[active];
  const description = shown
    .map((slice) => `${slice.name} ${chartPercent(slice.value, sum)}`)
    .join(', ');

  return (
    <div className={cn('@container min-w-0', className)}>
      <div className="flex min-w-0 items-center gap-4 @max-sm:flex-col @max-sm:items-stretch">
        <div // NOSONAR -- the drawing and its centre copy are one picture; <img> cannot hold them
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the drawing and its centre copy are one picture
          role="img"
          aria-label={`${label}: ${description}`}
          className="relative size-38 shrink-0 self-center"
        >
          <svg
            aria-hidden
            focusable="false"
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="block overflow-visible"
          >
            <defs>
              <ChartHatchPattern id={hatch} />
            </defs>
            <circle
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-chart-grid"
            />
            {shown.map((slice, index) => {
              const tone = chartTone(slice, index);
              const arc = arcs[index] ?? { dash: 0, offset: 0 };
              return (
                <circle
                  key={slice.name}
                  cx={CENTRE}
                  cy={CENTRE}
                  r={RADIUS}
                  fill="none"
                  stroke={tone === 4 ? `url(#${hatch})` : undefined}
                  strokeWidth={active === index ? STROKE + 4 : STROKE}
                  strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                  strokeDashoffset={arc.offset}
                  // Rotated so the first slice starts at twelve o'clock.
                  transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  className={cn(
                    'transition-[stroke-width] duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                    tone === 4 ? undefined : CHART_STROKE[tone],
                  )}
                />
              );
            })}
          </svg>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5"
          >
            <span className="type-figure-ring">
              {highlighted ? chartPercent(highlighted.value, sum) : format(total ?? sum)}
            </span>
            <span className="type-eyebrow max-w-24 truncate">
              {highlighted ? highlighted.name : totalLabel}
            </span>
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
          {shown.map((slice, index) => (
            <li key={slice.name}>
              {/* A button so the keyboard reaches the same highlight as the pointer. */}
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className={cn(
                  'focus-ring text-body-sm grid h-[var(--control-md)] w-full grid-cols-[8px_minmax(0,1fr)_48px_36px] items-center gap-x-2 rounded-sm px-2 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                  active === index && 'bg-surface-sunken',
                )}
              >
                <ChartSwatch tone={chartTone(slice, index)} />
                <span className="text-ink truncate">{slice.name}</span>
                <span className="text-ink text-right font-medium tabular-nums">
                  {chartPercent(slice.value, sum)}
                </span>
                <span className="text-ink-muted text-right tabular-nums">
                  {format(slice.value)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
