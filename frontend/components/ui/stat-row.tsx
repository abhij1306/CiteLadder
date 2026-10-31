'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { listRowClasses } from '@/components/ui/list-row';
import { ComparisonValue, MetricValue } from '@/components/ui/metric-value';
import { ScoreRing } from '@/components/ui/score-ring';
import { textRole } from '@/components/ui/typography';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * StatRow — the one KPI row: a band of equal segments divided by hairlines.
 *
 * It replaced `StatGrid` (three surfaces, three column counts, two value
 * sizes), `MetricGroup`/`MetricItem`, the Site Health `AuditMetricStrip` and
 * the Command Center's `StateMetric`: five recipes for the same "label, value,
 * sub-line" fact, each with its own padding and value size. Now there is one
 * geometry, owned here:
 *
 *   - segments are equal: one row of up to four on desktop, balanced across
 *     rows beyond that (five → 3 + 2, six → 3 + 3), stacked below desktop;
 *   - a hairline divides neighbouring segments and rows, never boxes them;
 *   - every segment is padded 12 above and below and 16 from its divider,
 *     with the row's outer edges (top and bottom included) flush to the
 *     containing card's own inset;
 *   - the segments of a row share one height, so a ring beside a figure, or a
 *     sub-line under one value and not its neighbour, never staggers the row.
 *
 * A segment's anatomy, in order: label (with an optional leading icon and a
 * trailing marker), an optional caption naming the value's period, the value
 * (the `figure` role), a delta, a sub-line, a comparison window's value, and
 * one action. A score ring takes the segment's top right instead of the value's place.
 *
 * `value: null` is the missing state — the muted dash with `missingLabel`
 * (default "Not measured") as its accessible name. A string or number is the
 * measured value; any other node (a `Badge`, an `UnavailableValue`) renders
 * as given.
 *
 * A segment with `onSelect` is pressable: the whole segment is the target,
 * named by `actionLabel`; `selected` makes it a toggle (`aria-pressed`).
 */

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

type StatValue =
  | { value: ReactNode; score?: undefined }
  /** A 0–100 score drawn as the ring, named by `label`. */
  | { score: Readonly<{ value: number; label: string }>; value?: undefined };

type StatAction =
  | { onSelect?: undefined; actionLabel?: undefined; selected?: undefined }
  | { onSelect: () => void; actionLabel: string; selected?: boolean };

export type StatSegment = Readonly<
  {
    key: string;
    label: ReactNode;
    icon?: LucideIcon;
    /** Accessible name of the missing state. Defaults to "Not measured". */
    missingLabel?: string;
    loading?: boolean;
    tone?: StatTone;
    /** A small mark at the end of the label row (series key, info hint). */
    marker?: ReactNode;
    /** A caption above the value, e.g. the period it covers. */
    caption?: ReactNode;
    delta?: ReactNode;
    /** The sub-line under the value. */
    sub?: ReactNode;
    /**
     * A second window's own value under the first (never a ratio): a hairline,
     * the label naming that window, and its figure in the smaller numeral.
     * It shares the segment's `loading` and `missingLabel`.
     */
    comparison?: Readonly<{ label: ReactNode; value: string | null }>;
    /** One link or button at the segment's foot. */
    action?: ReactNode;
  } & StatValue &
    StatAction
>;

/** At most four segments a row; more are balanced across rows. */
const MAX_PER_ROW = 4;

const DESKTOP_COLUMNS = {
  1: 'desktop:grid-cols-1',
  2: 'desktop:grid-cols-2',
  3: 'desktop:grid-cols-3',
  4: 'desktop:grid-cols-4',
} as const;

function rowsOf(segments: readonly StatSegment[]) {
  const rowCount = Math.ceil(segments.length / MAX_PER_ROW);
  const perRow = Math.ceil(segments.length / Math.max(1, rowCount));
  const rows: StatSegment[][] = [];
  for (let start = 0; start < segments.length; start += perRow) {
    rows.push(segments.slice(start, start + perRow));
  }
  return { rows, columns: Math.max(1, Math.min(MAX_PER_ROW, perRow)) as 1 | 2 | 3 | 4 };
}

export function StatRow({
  segments,
  label,
  testId,
}: Readonly<{
  segments: readonly StatSegment[];
  /** Accessible name for the group, when the section heading does not give one. */
  label?: string;
  testId?: string;
}>) {
  const { rows, columns } = rowsOf(segments);
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      data-testid={testId}
      data-stat-row=""
      // The row's outer edges are flush with its container's inset on all
      // four sides: the segments keep their 12 above and below, and the row
      // pulls back by that much so the first figure starts where the card's
      // other content would.
      className="divide-border-subtle -my-3 grid min-w-0 divide-y"
    >
      {rows.map((row) => (
        <dl
          key={row.map((segment) => segment.key).join('|')}
          className={cn(
            'divide-border-subtle grid min-w-0 divide-y',
            'desktop:divide-x desktop:divide-y-0',
            DESKTOP_COLUMNS[columns],
          )}
        >
          {row.map((segment) => (
            <Segment key={segment.key} segment={segment} />
          ))}
        </dl>
      ))}
    </div>
  );
}

/** The ring spans exactly the rows beside it, so no empty row pads the segment's foot. */
const ROW_SPAN = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
  5: 'row-span-5',
  6: 'row-span-6',
} as const;

function textRows(segment: StatSegment) {
  const optional = [
    segment.caption,
    segment.delta,
    segment.sub,
    segment.comparison,
    segment.action,
  ];
  return (1 + optional.filter(Boolean).length) as keyof typeof ROW_SPAN;
}

function Segment({ segment }: Readonly<{ segment: StatSegment }>) {
  const pressable = Boolean(segment.onSelect);
  // A score ring sits at the segment's top right; the rest stacks in the first column.
  const main = segment.score ? 'col-start-1' : '';
  return (
    <div
      data-stat-segment=""
      className={cn(
        'grid min-w-0 content-start gap-1 py-3 desktop:px-4 desktop:first:ps-0 desktop:last:pe-0',
        segment.score && 'grid-cols-[minmax(0,1fr)_auto] gap-x-4',
        pressable && cn('relative', listRowClasses({ selected: segment.selected ?? false })),
      )}
    >
      {segment.score ? (
        <dd className={cn('col-start-2 row-start-1', ROW_SPAN[textRows(segment)])}>
          <ScoreRing value={segment.score.value} label={segment.score.label} />
        </dd>
      ) : null}
      <SegmentLabel segment={segment} className={main} />
      <SegmentBody segment={segment} className={main} />
      <SegmentFoot segment={segment} className={main} />
      {pressable ? (
        <button
          type="button"
          onClick={segment.onSelect}
          aria-label={segment.actionLabel}
          aria-pressed={segment.selected}
          className="focus-ring absolute inset-0 rounded-[inherit]"
        />
      ) : null}
    </div>
  );
}

type SegmentPart = Readonly<{ segment: StatSegment; className: string }>;

/** The label row: a label wraps to a second line rather than cutting a metric's name. */
function SegmentLabel({ segment, className }: SegmentPart) {
  const Icon = segment.icon;
  return (
    <dt
      className={textRole(
        'label',
        cn('flex min-w-0 items-center justify-between gap-2', className),
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="text-muted size-4 shrink-0" aria-hidden /> : null}
        <span className="line-clamp-2 min-w-0">{segment.label}</span>
      </span>
      {segment.marker ? (
        <span
          className={cn('flex shrink-0 items-center gap-2', segment.onSelect && 'relative z-10')}
        >
          {segment.marker}
        </span>
      ) : null}
    </dt>
  );
}

/** The caption and value; a ring segment's value is the ring itself. */
function SegmentBody({ segment, className }: SegmentPart) {
  if (segment.score && !segment.caption) return null;
  return (
    <dd className={cn('grid min-w-0 gap-1', className)}>
      {segment.caption ? <span className={textRole('caption')}>{segment.caption}</span> : null}
      {segment.score ? null : <SegmentValue segment={segment} />}
    </dd>
  );
}

/** Delta, sub-line, comparison and the one action, in that order. */
function SegmentFoot({ segment, className }: SegmentPart) {
  return (
    <>
      {segment.delta ? <dd className={cn('min-w-0', className)}>{segment.delta}</dd> : null}
      {segment.sub ? (
        <dd className={textRole('caption', cn('min-w-0', className))}>{segment.sub}</dd>
      ) : null}
      <SegmentComparison segment={segment} className={className} />
      {segment.action ? (
        <dd className={cn('min-w-0', className, segment.onSelect && 'relative z-10')}>
          {segment.action}
        </dd>
      ) : null}
    </>
  );
}

/** A second window's value under the first, or nothing without one. */
function SegmentComparison({
  segment,
  className,
}: Readonly<{ segment: StatSegment; className: string }>) {
  if (!segment.comparison) return null;
  return (
    <dd
      data-stat-comparison=""
      className={textRole(
        'caption',
        cn('border-border-subtle grid min-w-0 border-t pt-1', className),
      )}
    >
      <span>{segment.comparison.label}</span>
      <ComparisonValue
        value={segment.comparison.value}
        label={segment.missingLabel ?? availabilityLabel('not_measured')}
        loading={segment.loading ?? false}
      />
    </dd>
  );
}

function SegmentValue({ segment }: Readonly<{ segment: StatSegment }>) {
  const { value } = segment;
  const tone = TONE[segment.tone ?? 'default'];
  if (segment.loading || value == null || typeof value === 'string' || typeof value === 'number') {
    return (
      <MetricValue
        value={value == null ? null : String(value)}
        label={segment.missingLabel ?? availabilityLabel('not_measured')}
        loading={segment.loading ?? false}
        tone={tone}
        className="min-w-0 [overflow-wrap:anywhere]"
      />
    );
  }
  return <div className={textRole('figure', cn('min-w-0', tone))}>{value}</div>;
}
