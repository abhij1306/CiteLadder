import type { ReactNode } from 'react';

import {
  CHART_FILL,
  ChartHatch,
  chartPercent,
  formatChartCount,
  type ChartTone,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

export type BarListItem = Readonly<{
  label: string;
  value: number;
  /** Your brand's row: `data-1`, and its label in the medium weight. */
  own?: boolean;
  /** The merged remainder: hatched, and always the last row. */
  other?: boolean;
  /** A 16px mark before the label, such as a BrandMark. */
  mark?: ReactNode;
}>;

const ROW = 'grid grid-cols-[minmax(120px,220px)_1fr_56px_64px] items-center gap-x-4';

/**
 * BarList — a ranked list of horizontal bars, each with its label, value and
 * share: cited domains, top pages, mentions by engine. Your brand's bar is
 * `data-1`, every other bar `data-3`, and Other is hatched and comes last.
 * Bars scale to the largest value; rows are 40px with fixed value and share
 * columns. A table to assistive technology, so every figure is read in place.
 */
export function BarList({
  items,
  total,
  header,
  format = formatChartCount,
  label,
  className,
}: Readonly<{
  /** Ranked, largest first; an `other` row is moved to the end. */
  items: readonly BarListItem[];
  /** The whole the share column is of; defaults to the items' sum. */
  total?: number;
  /** The label, value and share column headings. */
  header?: readonly [string, string, string];
  format?: (value: number) => string;
  /** What the list ranks, e.g. "Cited domains". */
  label: string;
  className?: string;
}>) {
  const rows = [...items.filter((item) => !item.other), ...items.filter((item) => item.other)];
  const whole = total ?? rows.reduce((carry, item) => carry + item.value, 0);
  const largest = Math.max(1, ...rows.map((item) => item.value));
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a table's semantics on a grid of rows; <table> cannot lay out fixed bar columns
    <div role="table" aria-label={label} className={cn('flex min-w-0 flex-col', className)}>
      {header ? (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the table above
        <div role="row" className={cn(ROW, 'text-caption text-ink-muted h-7 font-medium')}>
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the table above */}
          <span role="columnheader">{header[0]}</span>
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the table above */}
          <span role="columnheader">
            <span className="sr-only">Bar</span>
          </span>
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the table above */}
          <span role="columnheader" className="text-right">
            {header[1]}
          </span>
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the table above */}
          <span role="columnheader" className="text-right">
            {header[2]}
          </span>
        </div>
      ) : null}
      {rows.map((item, index) => (
        <BarListRow
          key={`${item.label}-${index}`}
          item={item}
          width={(item.value / largest) * 100}
          value={format(item.value)}
          share={chartPercent(item.value, whole)}
        />
      ))}
    </div>
  );
}

/** Other is hatched, your brand `data-1`, every other bar `data-3`: never by rank. */
function barTone(item: BarListItem): ChartTone {
  if (item.other) return 4;
  return item.own ? 1 : 3;
}

function BarListRow({
  item,
  width,
  value,
  share,
}: Readonly<{ item: BarListItem; width: number; value: string; share: string }>) {
  const tone = barTone(item);
  return (
    <div // NOSONAR -- see BarList's table: <tr> cannot lay out the fixed bar columns
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see BarList's table
      role="row"
      className={cn(ROW, 'text-body-sm h-10')}
    >
      <span // NOSONAR -- see BarList's table
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see BarList's table
        role="cell"
        className="text-ink flex min-w-0 items-center gap-2"
      >
        {item.mark ?? null}
        <span className={cn('truncate', item.own && 'font-medium')}>{item.label}</span>
      </span>
      <span // NOSONAR -- see BarList's table
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see BarList's table
        role="cell"
        className="flex h-full min-w-0 items-center"
      >
        {/* A zero is no bar at all, never a sliver that reads as a little. */}
        {width > 0 ? (
          <span
            aria-hidden
            className={cn(
              'block h-2.5 overflow-hidden rounded-2xs',
              tone === 4 ? undefined : CHART_FILL[tone],
            )}
            style={{ width: `${Math.max(0.5, width)}%` }}
          >
            {tone === 4 ? <ChartHatch /> : null}
          </span>
        ) : null}
      </span>
      <span // NOSONAR -- see BarList's table
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see BarList's table
        role="cell"
        className="text-ink text-right font-medium whitespace-nowrap tabular-nums"
      >
        {value}
      </span>
      <span // NOSONAR -- see BarList's table
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see BarList's table
        role="cell"
        className="text-ink-muted text-right whitespace-nowrap tabular-nums"
      >
        {share}
      </span>
    </div>
  );
}
