import type { ReactNode } from 'react';

import {
  CHART_FILL,
  ChartHatch,
  ChartSwatch,
  chartPercent,
  chartTone,
  formatChartCount,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

export type StackedSegment = Readonly<{
  label: string;
  value: number;
  /** The merged remainder: hatched, so it never reads as another part. */
  other?: boolean;
}>;

/**
 * StackedBar — one 100% bar split into up to four parts, with a legend of
 * shares and counts: cited source types, answers by engine. Colour by order
 * (your site first in `data-1`, then `data-2`, `data-3`), Other hatched; 2px
 * gaps, a 12px fully rounded bar. One image to assistive technology, named
 * with every share and count.
 *
 * When `total` is larger than the parts, the rest belongs to no part: it stays
 * unfilled `chart-grid` track and is listed as `remainderLabel`, so the parts
 * are never stretched to fill a whole they do not cover.
 */
export function StackedBar({
  segments,
  total,
  remainderLabel = 'Unclassified',
  format = formatChartCount,
  label = 'Breakdown',
  className,
}: Readonly<{
  /** Your site first, at most three plus Other. */
  segments: readonly StackedSegment[];
  /** The whole the shares are of; defaults to the segments' sum. */
  total?: number;
  /** What the part of `total` no segment covers is called. */
  remainderLabel?: string;
  format?: (value: number) => string;
  /** What the bar breaks down, e.g. "Source types". */
  label?: string;
  className?: string;
}>) {
  const parts = segments.slice(0, 4);
  const sum = parts.reduce((carry, segment) => carry + segment.value, 0);
  const whole = Math.max(total ?? sum, sum);
  const remainder = whole - sum;
  const entries = parts.map((segment, index) => ({ ...segment, tone: chartTone(segment, index) }));
  const described = [
    ...entries.map((entry) => ({ label: entry.label, value: entry.value })),
    ...(remainder > 0 ? [{ label: remainderLabel, value: remainder }] : []),
  ]
    .map((entry) => `${entry.label} ${chartPercent(entry.value, whole)} (${format(entry.value)})`)
    .join(', ');

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div // NOSONAR -- the segments are one picture of a whole; <img> cannot hold them
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the segments are one picture of a whole
        role="img"
        aria-label={described ? `${label}: ${described}` : label}
        className="rounded-2xs flex h-3 gap-0.5 overflow-hidden"
      >
        {entries.map((entry) =>
          // A zero is left out of the bar, never drawn as a sliver.
          entry.value > 0 ? (
            <span
              key={entry.label}
              className={cn(
                'block h-full min-w-0.5 basis-0 overflow-hidden',
                entry.tone === 4 ? undefined : CHART_FILL[entry.tone],
              )}
              style={{ flexGrow: entry.value }}
            >
              {entry.tone === 4 ? <ChartHatch /> : null}
            </span>
          ) : null,
        )}
        {remainder > 0 || whole === 0 ? (
          <span
            className="bg-chart-grid block h-full min-w-0.5 basis-0"
            style={{ flexGrow: whole === 0 ? 1 : remainder }}
          />
        ) : null}
      </div>
      <ul aria-hidden className="flex flex-wrap gap-x-6 gap-y-2">
        {entries.map((entry) => (
          <StackedLegendItem
            key={entry.label}
            swatch={<ChartSwatch tone={entry.tone} />}
            label={entry.label}
            share={chartPercent(entry.value, whole)}
            value={format(entry.value)}
          />
        ))}
        {remainder > 0 ? (
          <StackedLegendItem
            swatch={<span className="bg-chart-grid rounded-2xs inline-block size-2 shrink-0" />}
            label={remainderLabel}
            share={chartPercent(remainder, whole)}
            value={format(remainder)}
          />
        ) : null}
      </ul>
    </div>
  );
}

function StackedLegendItem({
  swatch,
  label,
  share,
  value,
}: Readonly<{ swatch: ReactNode; label: string; share: string; value: string }>) {
  return (
    <li className="text-body-sm inline-flex items-center gap-2 whitespace-nowrap">
      {swatch}
      <span className="text-ink-secondary">{label}</span>
      <span className="text-ink font-medium tabular-nums">{share}</span>
      <span className="text-ink-muted tabular-nums">{value}</span>
    </li>
  );
}
