'use client';

import { ChevronDown, RefreshCw, RotateCcw } from 'lucide-react';

import { INITIAL_SELECTION, type RangeSelection } from '@/lib/performance/performance';
import type { usePerformanceSync } from './use-performance-sync';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { FilterField } from '@/components/ui/filter-bar';
import { SegmentedAction, SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import type { PerformanceGranularity } from '@/lib/api/performance';
import {
  DIALOG_RANGE_OPTIONS,
  GRANULARITY_OPTIONS,
  QUICK_RANGE_OPTIONS,
} from '@/lib/performance/performance';

/** The three ranges that live on the track; everything else is behind More. */
type QuickRange = (typeof QUICK_RANGE_OPTIONS)[number]['value'];

/**
 * The Performance surface's chrome: the control bar above the cards, the
 * chart's bucket-size select, and the notice stack.
 *
 * Split from `performance-screen.tsx` to keep that module inside the 500-LOC
 * budget. These are presentation only — every piece of state they render is
 * owned by the screen and passed in.
 */

function getMoreLabel(selection: RangeSelection, comparing: boolean): string {
  if (comparing) return 'Compare';
  if (selection.range === '3_months') return '3 months';
  if (selection.range === '6_months') return '6 months';
  if (selection.range === 'last_synced') return 'Last synced';
  if (selection.range === 'custom') return 'Custom';
  return 'More';
}

/** True when the active range is one of the ones hiding behind More. */
function isRangeBehindMore(selection: RangeSelection, comparing: boolean): boolean {
  if (comparing) return true;
  return DIALOG_RANGE_OPTIONS.some((option) => option.value === selection.range);
}

/**
 * The quick-range track's value. Comparing, or any range that lives in the
 * dialog, is deliberately off-list: the control renders that as "nothing
 * selected" and More carries the state instead.
 */
function quickRangeValue(selection: RangeSelection, comparing: boolean): QuickRange {
  if (comparing) return '' as QuickRange;
  return selection.range as QuickRange;
}

/** The dashboard's control bar: resolved range, imported coverage, and sync. */
export function PerformanceToolbar({
  selection,
  selectedLabel,
  onOpenRange,
  onOpenCompare,
  onSelectRange,
  comparing,
  onReset,
}: Readonly<{
  selection: RangeSelection;
  selectedLabel: string;
  onOpenRange: () => void;
  onOpenCompare: () => void;
  onSelectRange: (next: RangeSelection) => void;
  /** True while a comparison is active — the button's and Reset's state. */
  comparing: boolean;
  onReset: () => void;
}>) {
  const moreLabel = getMoreLabel(selection, comparing);
  const isMoreActive = isRangeBehindMore(selection, comparing);

  return (
    // `contents`: the control band owns the row's height and its rule.
    <div className="contents">
      {/* Day, Week and Month are the three choices; More opens the dialog that
          holds 3 months, 6 months, Last synced, Custom and Compare.

          This was a hand-built <fieldset> of aria-pressed toggles wrapped around
          Pressable, which is the ROW affordance — it forced w-full and text-left
          onto every segment — and it described three mutually exclusive ranges
          as independent toggles with no arrow-key navigation. The shared control
          owns all of that; More rides its trailing slot. */}
      <SegmentedControl
        value={quickRangeValue(selection, comparing)}
        onChange={(range) => onSelectRange({ ...INITIAL_SELECTION, range })}
        options={QUICK_RANGE_OPTIONS}
        ariaLabel="Date range"
        trailing={
          <SegmentedAction
            selected={isMoreActive}
            aria-haspopup="dialog"
            data-testid="compare-button"
            onClick={comparing ? onOpenCompare : onOpenRange}
          >
            {moreLabel}
            <Icon icon={ChevronDown} className="opacity-70" />
          </SegmentedAction>
        }
      />

      <span className="type-body" data-testid="performance-window">
        {selectedLabel}
      </span>
      {/* Reset belongs to the comparison: it is what returns "Compare" to
          "More". With no comparison active there is nothing it would undo. */}
      {comparing ? (
        <Button variant="ghost" onClick={onReset} data-testid="reset-filters-button">
          <Icon icon={RotateCcw} />
          Reset filters
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Importing is an action on the project, not a narrowing of what is shown, so
 * it rides the identity band with every other route action rather than the end
 * of the filter row.
 */
export function PerformanceActions({
  latestDate,
  hasConnections,
  sync,
}: Readonly<{
  latestDate: string | null;
  hasConnections: boolean;
  sync: ReturnType<typeof usePerformanceSync>;
}>) {
  return (
    <>
      <span className="type-caption">
        {latestDate ? `Data through ${latestDate}` : 'No imported history'}
      </span>
      <Button
        variant="secondary"
        onClick={() => sync.mutation.mutate()}
        disabled={!hasConnections}
        pending={sync.syncing || sync.mutation.isPending}
        pendingLabel="Syncing…"
        data-testid="sync-now-button"
      >
        <Icon icon={RefreshCw} />
        Sync now
      </Button>
    </>
  );
}

/**
 * The chart's bucket-size control, at the plot's top-right.
 *
 * Deliberately NOT in the toolbar with the range quick-selects: the range
 * picks which window is charted, this picks how that window is bucketed, and
 * putting both in one row invites reading them as the same control (they
 * even share the words day/week/month).
 */
export function GranularitySelect({
  value,
  onChange,
}: Readonly<{
  value: PerformanceGranularity;
  onChange: (next: PerformanceGranularity) => void;
}>) {
  return (
    <FilterField>
      <Select
        value={value}
        onValueChange={onChange}
        options={GRANULARITY_OPTIONS}
        ariaLabel="Chart bucket size"
      />
    </FilterField>
  );
}

/**
 * The one sentence describing uncovered windows, or null when both are covered.
 *
 * Each case names the recovery that actually applies: an uncovered selected
 * range is fixable by syncing or by picking a covered range, while an
 * uncovered comparison only explains why that column reads as not measured.
 */
function missingCoverageNotice(
  selectedMissing: boolean,
  comparisonMissing: boolean,
): string | null {
  if (selectedMissing && comparisonMissing) {
    return 'No imported data covers this range or its comparison period yet. Sync to import it, or choose a range inside the covered history.';
  }
  if (selectedMissing) {
    return 'No imported data covers this range yet. Sync to import it, or choose a range inside the covered history.';
  }
  if (comparisonMissing) {
    return 'The comparison period has no imported data, so its columns show as not measured.';
  }
  return null;
}

export function PerformanceNotices({
  sync,
  projecting,
  selectedMissing,
  comparisonMissing,
}: Readonly<{
  sync: ReturnType<typeof usePerformanceSync>;
  projecting: boolean;
  selectedMissing: boolean;
  comparisonMissing: boolean;
}>) {
  const coverageNotice = missingCoverageNotice(selectedMissing, comparisonMissing);
  return (
    <>
      {sync.syncing ? (
        <Alert tone="info" hideIcon>
          <Inline as="span" data-testid="sync-status-banner">
            <Spinner />
            <span>
              Sync in progress — importing the dates not yet covered. Charts and tables update when
              it completes.
            </span>
          </Inline>
        </Alert>
      ) : null}
      {sync.notice ? <Alert tone="info">{sync.notice}</Alert> : null}
      {sync.error ? <Alert tone="info">{sync.error}</Alert> : null}
      {sync.outcome === 'failed' ? (
        <Alert tone="warning">
          Sync finished with errors — previously imported data is unchanged. Check Settings →
          Integrations for details.
        </Alert>
      ) : null}
      {projecting ? <Alert tone="info">Building this range from imported data…</Alert> : null}
      {/* Coverage is ONE notice, not one per window. The selected and
          comparison ranges are routinely both uncovered — a fresh connection
          covers neither — and as two separate alerts that stacked into a wall
          of blue saying the same thing twice. Which windows are affected is
          the only part that actually differs, so that is the part the sentence
          varies. */}
      {!projecting && coverageNotice ? <Alert tone="info">{coverageNotice}</Alert> : null}
    </>
  );
}
