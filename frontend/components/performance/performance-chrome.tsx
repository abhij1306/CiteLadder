import { ChevronDown, RefreshCw, RotateCcw } from 'lucide-react';

import {
  INITIAL_GRANULARITY,
  INITIAL_SELECTION,
  type RangeSelection,
} from '@/lib/performance/performance';
import type { usePerformanceSync } from './use-performance-sync';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import type { StatusMessage } from '@/components/ui/status-line';
import { QueryState } from '@/components/ui/query-state';
import type { useRangeProjection } from './use-range-projection';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { SegmentedAction, SegmentedControl } from '@/components/ui/tabs';
import type { PerformanceGranularity } from '@/lib/api/performance';
import { formatWindowDate } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';
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
 * Split from `performance-screen.tsx`. These are presentation only — every
 * piece of state they render is owned by the screen and passed in.
 */

function getMoreLabel(selection: RangeSelection, comparing: boolean): string {
  if (comparing) return 'Compare';
  return DIALOG_RANGE_OPTIONS.find((option) => option.value === selection.range)?.label ?? 'More';
}

/** Every label More can show, so it keeps the widest one's width. */
const MORE_LABELS = ['More', 'Compare', ...DIALOG_RANGE_OPTIONS.map((option) => option.label)];

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

/**
 * The resolved window, as the control band's caption: it describes what the
 * range controls selected, so it reads as a note beside them, not as one more
 * filter.
 */
export function PerformanceWindowCaption({ label }: Readonly<{ label: string }>) {
  return <span data-testid="performance-window">{label}</span>;
}

/** The dashboard's range controls, leading its control row as its view: the quick windows, More, and Reset. */
export function PerformanceToolbar({
  selection,
  onOpenRange,
  onOpenCompare,
  onSelectRange,
  comparing,
  onReset,
}: Readonly<{
  selection: RangeSelection;
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
      {/* The last day, 7 days and 28 days are the three choices; More opens
          the dialog that holds 90 and 180 days, Last synced, Custom and Compare.

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
            label={moreLabel}
            labels={MORE_LABELS}
          >
            <Icon icon={ChevronDown} className="opacity-70" />
          </SegmentedAction>
        }
      />
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
  noConnections,
  sync,
}: Readonly<{
  latestDate: string | null;
  /** The connections read answered with none; unknown is not none. */
  noConnections: boolean;
  sync: ReturnType<typeof usePerformanceSync>;
}>) {
  // Syncing is a run; a role without it reads the imported history only.
  const canRun = useWorkspaceCapability('run');
  return (
    <>
      <span className="type-caption">
        {latestDate ? `Data through ${formatWindowDate(latestDate)}` : 'No imported history'}
      </span>
      {canRun ? (
        <Button
          variant="secondary"
          onClick={sync.start}
          disabled={noConnections}
          pending={sync.syncing || sync.mutation.isPending}
          pendingLabel="Syncing…"
          data-testid="sync-now-button"
        >
          <Icon icon={RefreshCw} />
          Sync now
        </Button>
      ) : null}
    </>
  );
}

/**
 * The chart's bucket size, in All filters (D57): it changes how the window is
 * read, like AI Traffic's chart interval, while the range leads the row.
 */
export function granularityFilter(
  value: PerformanceGranularity,
  onChange: (next: PerformanceGranularity) => void,
): FilterDefinition {
  return choiceFilter({
    id: 'granularity',
    label: 'Chart interval',
    value,
    defaultValue: INITIAL_GRANULARITY,
    groups: [{ options: GRANULARITY_OPTIONS }],
    onChange,
  });
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

/** A failed range build: what happened, and Retry for exactly that window. */
export function ProjectionFailure({
  failure,
}: Readonly<{ failure: ReturnType<typeof useRangeProjection>['failure'] }>) {
  if (!failure) return null;
  return (
    <QueryState
      kind="error"
      title="Couldn't build this range"
      error={failure.error}
      fallback="Building this range from imported data failed."
      onRetry={failure.retry}
      pending={failure.pending}
    />
  );
}

/**
 * The screen's notices, most important first, for its one `StatusLine`:
 * they swap in place rather than stacking banners above the chart.
 */
export function performanceNotices({
  sync,
  projecting,
  projectionFailed,
  selectedMissing,
  comparisonMissing,
  qualityFlagged,
  readinessFailed,
}: Readonly<{
  sync: ReturnType<typeof usePerformanceSync>;
  projecting: boolean;
  /** Building the missing window failed: a failure with Retry, not "no imported data". */
  projectionFailed: boolean;
  selectedMissing: boolean;
  comparisonMissing: boolean;
  /** Some imported days of a mapped provider are missing, flagged or on a prior revision. */
  qualityFlagged: boolean;
  readinessFailed: boolean;
}>): StatusMessage[] {
  const messages: StatusMessage[] = [];
  if (sync.error) messages.push({ key: 'sync-error', tone: 'warning', text: sync.error });
  if (readinessFailed)
    messages.push({
      key: 'readiness',
      tone: 'warning',
      text: 'Could not load data readiness. Check your connection and try again.',
    });
  if (sync.outcome === 'failed')
    messages.push({
      key: 'sync-failed',
      tone: 'warning',
      text: 'Sync finished with errors — previously imported data is unchanged. Check Settings → Integrations for details.',
    });
  if (sync.syncing)
    messages.push({
      key: 'syncing',
      tone: 'info',
      busy: true,
      text: 'Sync in progress — importing the dates not yet covered. Charts and tables update when it completes.',
    });
  if (sync.notice) messages.push({ key: 'sync-notice', tone: 'info', text: sync.notice });
  if (projecting)
    messages.push({
      key: 'projecting',
      tone: 'info',
      busy: true,
      text: 'Building this range from imported data…',
    });
  if (projectionFailed)
    messages.push({
      key: 'projection-failed',
      tone: 'warning',
      text: "Couldn't build this range from imported data. Retry to build it again.",
    });
  // Coverage is ONE notice, not one per window: the selected and comparison
  // ranges are routinely both uncovered, and which windows are affected is
  // the only part that differs, so that is the part the sentence varies. A
  // failed build is not missing data, so it never claims nothing covers it.
  const coverageNotice =
    projecting || projectionFailed
      ? null
      : missingCoverageNotice(selectedMissing, comparisonMissing);
  if (coverageNotice) messages.push({ key: 'coverage', tone: 'info', text: coverageNotice });
  if (qualityFlagged)
    messages.push({
      key: 'quality',
      tone: 'info',
      text: 'Some imported days are missing or flagged, or come from an earlier complete import. Days without a usable import show no value, not zero.',
    });
  return messages;
}
