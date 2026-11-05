'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { AppGrid, type AppGridLayout } from '@/components/ui/app-grid';
import { cardClasses } from '@/components/ui/card';
import { ComparisonValue, MetricValue } from '@/components/ui/metric-value';
import { clampScore, ScoreRing } from '@/components/ui/score-ring';
import { availabilityLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * StatRow — the one KPI row: up to four Stats in one Card, separated by
 * 32px of space, never by rules.
 *
 *   - one row of up to four from the desktop breakpoint (982px included),
 *     balanced across rows beyond that (five → 3 + 2, six → 3 + 3), stacked
 *     below desktop; never 2 × 2, never 2 + 1;
 *   - the Stats of a row share one height, so a sub-line under one value and
 *     not its neighbour never staggers the row.
 *
 * A Stat's anatomy, in order: the mono eyebrow label (with an optional leading
 * icon and a trailing marker), an optional caption naming the value's period,
 * the value in Geist 500 (`stat` 28, decision D15), the change line (a `Delta`), a sub-line,
 * a comparison window's value, and one action. A 0–100 score is its number
 * in `stat` with a bare 48px `ScoreRing` (auto tone) centred on its right —
 * never a bar (decision D8).
 *
 * `value: null` is the missing state — the muted dash with `missingLabel`
 * (default "Not measured") as its accessible name. A string or number is the
 * measured value; any other node (a `Badge`, an `UnavailableValue`) renders
 * as given. A value always takes the foreground ink: colour means a state, so
 * it goes on the delta beside a figure, never on the figure itself.
 *
 * A Stat with `onSelect` is pressable: the whole Stat is the target, named by
 * `actionLabel`; `selected` makes it a toggle (`aria-pressed`).
 */

type StatValue =
  | { value: ReactNode; score?: undefined }
  /** A 0–100 score: its number with a bare ScoreRing, named by `label`. */
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
    /** A small mark at the end of the label row (series key, info hint). */
    marker?: ReactNode;
    /** A caption above the value, e.g. the period it covers. */
    caption?: ReactNode;
    delta?: ReactNode;
    /** The sub-line under the value. */
    sub?: ReactNode;
    /**
     * A second window's own value under the first (never a ratio): the label
     * naming that window, and its figure in the smaller numeral. It shares
     * the Stat's `loading` and `missingLabel`.
     */
    comparison?: Readonly<{ label: ReactNode; value: string | null }>;
    /** One link or button at the Stat's foot. */
    action?: ReactNode;
  } & StatValue &
    StatAction
>;

/** At most four Stats a row; more are balanced across rows. */
const MAX_PER_ROW = 4;

const DESKTOP_COLUMNS = {
  1: 'desktop:grid-cols-1',
  2: 'desktop:grid-cols-2',
  3: 'desktop:grid-cols-3',
  4: 'desktop:grid-cols-4',
} as const;

function columnsOf(count: number) {
  const rowCount = Math.ceil(count / MAX_PER_ROW);
  const perRow = Math.ceil(count / Math.max(1, rowCount));
  return Math.max(1, Math.min(MAX_PER_ROW, perRow)) as 1 | 2 | 3 | 4;
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
  return (
    <dl // NOSONAR -- a <fieldset> would add form-group semantics and its own border, padding and min-width to a grid of figures
      role={label ? 'group' : undefined}
      aria-label={label}
      data-testid={testId}
      data-stat-row=""
      className={cn(
        'grid min-w-0 grid-cols-1 gap-x-8 gap-y-6',
        DESKTOP_COLUMNS[columnsOf(segments.length)],
      )}
    >
      {segments.map((segment) => (
        <Stat key={segment.key} segment={segment} framed={false} />
      ))}
    </dl>
  );
}

/**
 * The KPI row's grid by count: one row from the desktop breakpoint for up to
 * five (decision D9: 4 across at 982px, never 2 × 2 or 2 + 1), stacked below.
 */
function kpiLayout(count: number): AppGridLayout {
  if (count === 5) return 'fifths';
  if (count === 3) return 'thirds';
  if (count === 2) return 'pair';
  return 'quarters';
}

/**
 * KpiRow — the row of numbers that opens a report page: each Stat in a Card
 * of its own (`surface`, `shadow-card`, 24 inset), up to four in a row, the
 * cards of a row at one height. A page's headline figures are a KpiRow; a
 * group of figures inside a card that also holds other content is a
 * `StatRow`.
 */
export function KpiRow({
  segments,
  label,
  testId,
}: Readonly<{
  segments: readonly StatSegment[];
  /** Accessible name for the group, when the section heading does not give one. */
  label?: string;
  testId?: string;
}>) {
  return (
    <AppGrid
      as="dl"
      layout={kpiLayout(segments.length)}
      role={label ? 'group' : undefined}
      aria-label={label}
      data-kpi-row=""
      data-testid={testId}
    >
      {segments.map((segment) => (
        <Stat key={segment.key} segment={segment} framed />
      ))}
    </AppGrid>
  );
}

/**
 * A pressable Stat's state: selected takes the shared selected fill and the
 * foreground ink; unselected takes the neutral hover.
 */
function statSelectionClasses(selected: boolean) {
  return cn(
    'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
    selected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
  );
}

function Stat({ segment, framed }: Readonly<{ segment: StatSegment; framed: boolean }>) {
  const pressable = Boolean(segment.onSelect);
  return (
    <div
      data-stat-segment={framed ? undefined : ''}
      className={cn(
        framed
          ? // A KPI is its own card; a pressable one is pressed as a whole card.
            cn(cardClasses(), 'relative grid min-w-0 content-start gap-1')
          : // Every Stat in a row carries the inset a pressable one's fill
            // needs, so its label never touches the selected fill's edge; the
            // matching negative margin keeps the figures on the row's grid.
            '-m-3 grid min-w-0 content-start gap-1 rounded-md p-3',
        pressable && cn('relative', statSelectionClasses(segment.selected ?? false)),
      )}
    >
      <StatLabel segment={segment} />
      <StatBody segment={segment} />
      <StatFoot segment={segment} />
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

type StatPart = Readonly<{ segment: StatSegment }>;

/** The eyebrow row: a label wraps to a second line rather than cutting a metric's name. */
function StatLabel({ segment }: StatPart) {
  const Icon = segment.icon;
  return (
    <dt className="type-eyebrow flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
        <span className="line-clamp-2 min-w-0">{segment.label}</span>
      </span>
      {segment.marker ? (
        <span
          className={cn(
            'flex shrink-0 items-center gap-2 normal-case',
            segment.onSelect && 'relative z-10',
          )}
        >
          {segment.marker}
        </span>
      ) : null}
    </dt>
  );
}

/**
 * The caption, then the value. A score's value is its number with the bare
 * ring on its right, centred on the number; the ring carries the accessible
 * "out of 100" name, so the drawn number is not read twice.
 */
function StatBody({ segment }: StatPart) {
  return (
    <dd className="grid min-w-0 gap-1">
      {segment.caption ? (
        <span className="text-caption text-ink-muted">{segment.caption}</span>
      ) : null}
      {segment.score ? (
        <span className="flex min-w-0 items-center justify-between gap-4">
          <span aria-hidden className="type-figure min-w-0">
            {clampScore(segment.score.value)}
          </span>
          <ScoreRing
            value={segment.score.value}
            label={segment.score.label}
            tone="auto"
            showValue={false}
          />
        </span>
      ) : (
        <StatValue segment={segment} />
      )}
    </dd>
  );
}

/** Delta, sub-line, comparison and the one action, in that order. */
function StatFoot({ segment }: StatPart) {
  return (
    <>
      {segment.delta ? <dd className="min-w-0">{segment.delta}</dd> : null}
      {segment.sub ? <dd className="text-caption text-ink-muted min-w-0">{segment.sub}</dd> : null}
      {segment.comparison ? (
        <dd data-stat-comparison="" className="text-caption text-ink-muted grid min-w-0 pt-1">
          <span>{segment.comparison.label}</span>
          <ComparisonValue
            value={segment.comparison.value}
            label={segment.missingLabel ?? availabilityLabel('not_measured')}
            loading={segment.loading ?? false}
          />
        </dd>
      ) : null}
      {segment.action ? (
        <dd className={cn('min-w-0', segment.onSelect && 'relative z-10')}>{segment.action}</dd>
      ) : null}
    </>
  );
}

function StatValue({ segment }: StatPart) {
  const { value } = segment;
  if (segment.loading || value == null || typeof value === 'string' || typeof value === 'number') {
    return (
      <MetricValue
        value={value == null ? null : String(value)}
        label={segment.missingLabel ?? availabilityLabel('not_measured')}
        loading={segment.loading ?? false}
        className="min-w-0 [overflow-wrap:anywhere]"
      />
    );
  }
  return <div className="type-figure min-w-0">{value}</div>;
}
