'use client';

import { createContext, useContext, useMemo, type HTMLAttributes, type ReactNode } from 'react';

import { listRowClasses } from '@/components/ui/list-row';
import { MetricValue } from '@/components/ui/metric-value';
import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * StatGrid — label/value facts beyond `MetricGroup`'s three to five headline
 * figures: a URL's delivery facts, an execution's evidence counts, a catalog's
 * inventory, a surface's rates.
 *
 * A stat is always the same anatomy, in this order, with the 4px label→value
 * rhythm the cell owns:
 *
 *   label (`label` role, optional marker at its end)
 *   caption (optional, `caption` — names the value's period when two stack)
 *   value (`figureSm` by default; `figure` for a grid of headline-weight facts)
 *   delta (optional, a `Delta`)
 *   detail (optional, `caption`)
 *
 * `value: null` is the missing state — the muted dash at the value's own size
 * with `missingLabel` (default "Not measured") as its accessible name, exactly
 * as `MetricValue` renders it. A string or number is the measured value; any
 * other node (a `Badge`, an `UnavailableValue` for a workflow state) is
 * rendered as given.
 *
 * Surfaces (`surface`):
 *   - `open`  — facts on the containing card; no boxes, the grid gap separates.
 *   - `well`  — each fact on a recessed well (evidence inside a drawer).
 *   - `band`  — one strip divided by hairlines, like a `MetricGroup` that wraps.
 *
 * An item with `onSelect` is pressable: the whole cell is the target,
 * reached by Tab and named by `actionLabel` (the visible number alone, "3", is
 * not a name anyone can act on). `selected` makes a toggle (`aria-pressed`)
 * and paints the shared selected-row face. The marker is raised above that
 * target, so a hint in it stays reachable by hover and Tab.
 */
const COLUMNS = {
  2: 'grid-cols-1 desktop:grid-cols-2',
  3: 'grid-cols-2 desktop:grid-cols-3',
  // One row on desktop, like `MetricGroup`: the sheet is ~700px wide even
  // beside the rail at a 981px desktop.
  4: 'grid-cols-2 desktop:grid-cols-4',
} as const;

export type StatGridColumns = keyof typeof COLUMNS;
export type StatGridSurface = 'open' | 'well' | 'band';
export type StatValueSize = 'figure' | 'figureSm';

/** A value's ink when the value itself is the finding. */
const TONE = {
  default: '',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  info: 'text-info-text',
  muted: 'text-muted',
} as const;

type StatTone = keyof typeof TONE;

type StatAction =
  | { onSelect?: undefined; actionLabel?: undefined; selected?: undefined }
  | { onSelect: () => void; actionLabel: string; selected?: boolean };

export type StatItemProps = Readonly<
  {
    label: ReactNode;
    value: ReactNode;
    /** Accessible name of the missing state. Defaults to "Not measured". */
    missingLabel?: string;
    loading?: boolean;
    delta?: ReactNode;
    detail?: ReactNode;
    tone?: StatTone;
    /** A small mark at the end of the label row (series key, info hint). */
    marker?: ReactNode;
    /** A caption above the value, e.g. the period it covers. */
    caption?: ReactNode;
    className?: string;
  } & StatAction
>;

const SURFACE_GRID: Record<StatGridSurface, string> = {
  open: 'gap-x-6 gap-y-4',
  well: 'gap-2',
  // Every cell draws its right and bottom hairline; the grid is pulled 1px out
  // under the clip so the outermost ones fall outside it. That draws only the
  // internal seams for any column count and any number of items.
  band: '-me-px -mb-px',
};

const SURFACE_ITEM: Record<StatGridSurface, string> = {
  open: '',
  well: panelClasses({ tone: 'well' }),
  band: 'border-border-subtle border-e border-b p-[var(--card-padding)]',
};

function StatValue({
  value,
  missingLabel,
  loading,
  size,
  tone,
}: Readonly<{
  value: ReactNode;
  missingLabel: string;
  loading: boolean;
  size: StatValueSize;
  tone: StatTone;
}>) {
  if (loading || value == null || typeof value === 'string' || typeof value === 'number') {
    return (
      <MetricValue
        value={value == null ? null : String(value)}
        label={missingLabel}
        size={size}
        loading={loading}
        tone={TONE[tone]}
        className="min-w-0 [overflow-wrap:anywhere]"
      />
    );
  }
  return <div className={textRole(size, cn('min-w-0', TONE[tone]))}>{value}</div>;
}

function StatAnatomy({ item, size }: Readonly<{ item: StatItemProps; size: StatValueSize }>) {
  return (
    <>
      {/* A label wraps to a second line rather than cutting a metric's name. */}
      <dt className={textRole('label', 'flex min-w-0 items-start justify-between gap-2')}>
        <span className="line-clamp-2 min-w-0">{item.label}</span>
        {item.marker ? (
          <span
            className={cn('flex shrink-0 items-center gap-2', item.onSelect && 'relative z-10')}
          >
            {item.marker}
          </span>
        ) : null}
      </dt>
      <dd className="grid min-w-0 gap-1">
        {item.caption ? <span className={textRole('caption')}>{item.caption}</span> : null}
        <StatValue
          value={item.value}
          missingLabel={item.missingLabel ?? availabilityLabel('not_measured')}
          loading={item.loading ?? false}
          size={size}
          tone={item.tone ?? 'default'}
        />
      </dd>
      {item.delta ? <dd className="min-w-0">{item.delta}</dd> : null}
      {item.detail ? <dd className={textRole('caption', 'min-w-0')}>{item.detail}</dd> : null}
    </>
  );
}

/** The stretched target: the whole cell is pressable, the facts stay a `dl`. */
function StatTarget({ item }: Readonly<{ item: StatItemProps }>) {
  return (
    <button
      type="button"
      onClick={item.onSelect}
      aria-label={item.actionLabel}
      aria-pressed={item.selected}
      className="focus-ring absolute inset-0 rounded-[inherit]"
    />
  );
}

/** The grid's value role and surface, so `StatItem` children inherit them. */
const StatGridContext = createContext<{ size: StatValueSize; surface: StatGridSurface }>({
  size: 'figureSm',
  surface: 'open',
});

export function StatItem(item: StatItemProps) {
  const { size, surface } = useContext(StatGridContext);
  const pressable = Boolean(item.onSelect);
  return (
    <div
      className={cn(
        'grid min-w-0 content-start gap-1',
        SURFACE_ITEM[surface],
        pressable && cn('relative', listRowClasses({ selected: item.selected ?? false })),
        item.className,
      )}
    >
      <StatAnatomy item={item} size={size} />
      {pressable ? <StatTarget item={item} /> : null}
    </div>
  );
}

export function StatGrid({
  items,
  children,
  columns = 4,
  surface = 'open',
  size = 'figureSm',
  label,
  className,
  ...props
}: Readonly<
  Omit<HTMLAttributes<HTMLElement>, 'children'> & {
    /** The facts, in reading order. Or pass `StatItem` children. */
    items?: readonly (StatItemProps & { key: string })[];
    children?: ReactNode;
    columns?: StatGridColumns;
    surface?: StatGridSurface;
    /** Value role for every item. */
    size?: StatValueSize;
    /** Accessible name for the group, when the section heading does not give one. */
    label?: string;
    /** On the grid's outermost element (the clip, for `band`), as are other props. */
    className?: string;
  }
>) {
  const band = surface === 'band';
  const context = useMemo(() => ({ size, surface }), [size, surface]);
  const grid = (
    <StatGridContext.Provider value={context}>
      <dl
        {...(band ? {} : props)}
        aria-label={label}
        className={cn('grid min-w-0', COLUMNS[columns], SURFACE_GRID[surface], !band && className)}
      >
        {items?.map(({ key, ...item }) => (
          <StatItem key={key} {...item} />
        ))}
        {children}
      </dl>
    </StatGridContext.Provider>
  );
  return band ? (
    <div {...props} className={cn('min-w-0 overflow-hidden', className)}>
      {grid}
    </div>
  ) : (
    grid
  );
}
