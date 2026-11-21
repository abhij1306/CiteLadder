import {
  INITIAL_GRANULARITY,
  INITIAL_SELECTION,
  type RangeSelection,
} from '@/lib/performance/performance';
import type { usePerformanceSync } from './use-performance-sync';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { useRangeProjection } from './use-range-projection';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { SegmentedAction, SegmentedControl } from '@/components/ui/tabs';
import { ChevronDown, RefreshCw, RotateCcw } from '@/lib/icons';
import type { PerformanceGranularity } from '@/lib/api/performance';
import { formatWindowDate } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import {
  DIALOG_RANGE_OPTIONS,
  GRANULARITY_OPTIONS,
  QUICK_RANGE_OPTIONS,
} from '@/lib/performance/performance';
import { StateBlock } from '@/components/ui/state-block';

type QuickRange = (typeof QUICK_RANGE_OPTIONS)[number]['value'];

function getMoreLabel(selection: RangeSelection, comparing: boolean): string {
  if (comparing) return 'Compare';
  return DIALOG_RANGE_OPTIONS.find((option) => option.value === selection.range)?.label ?? 'More';
}

const MORE_LABELS = ['More', 'Compare', ...DIALOG_RANGE_OPTIONS.map((option) => option.label)];

function isRangeBehindMore(selection: RangeSelection, comparing: boolean): boolean {
  if (comparing) return true;
  return DIALOG_RANGE_OPTIONS.some((option) => option.value === selection.range);
}

function quickRangeValue(selection: RangeSelection, comparing: boolean): QuickRange {
  if (comparing) return '' as QuickRange;
  return selection.range as QuickRange;
}

export function PerformanceWindowCaption({
  label,
  latestDate,
}: Readonly<{ label: string; latestDate: string | null }>) {
  return (
    <>
      <span data-testid="performance-window">{label}</span>
      <span>
        {latestDate ? `Data through ${formatWindowDate(latestDate)}` : 'No imported history'}
      </span>
    </>
  );
}

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
  comparing: boolean;
  onReset: () => void;
}>) {
  const moreLabel = getMoreLabel(selection, comparing);
  const isMoreActive = isRangeBehindMore(selection, comparing);

  return (
    <div className="contents">
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
      {comparing ? (
        <Button variant="quiet" onClick={onReset} data-testid="reset-filters-button">
          <Icon icon={RotateCcw} />
          Reset filters
        </Button>
      ) : null}
    </div>
  );
}

export function PerformanceActions({
  noConnections,
  sync,
}: Readonly<{
  noConnections: boolean;
  sync: ReturnType<typeof usePerformanceSync>;
}>) {
  const canRun = useWorkspaceCapability('run');
  return canRun ? (
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
  ) : null;
}

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

function missingCoverageNotice(
  selectedMissing: boolean,
  comparisonMissing: boolean,
): string | null {
  if (selectedMissing && comparisonMissing) {
    return 'No imported data covers this range or its comparison period yet.';
  }
  if (selectedMissing) {
    return 'No imported data covers this range yet.';
  }
  if (comparisonMissing) {
    return 'The comparison period has no imported data.';
  }
  return null;
}

export function ProjectionFailure({
  failure,
}: Readonly<{ failure: ReturnType<typeof useRangeProjection>['failure'] }>) {
  if (!failure) return null;
  return (
    <StateBlock
      kind="error"
      title="Couldn't build this range"
      error={failure.error}
      fallback="Building this range from imported data failed."
      onRetry={failure.retry}
      pending={failure.pending}
    />
  );
}

type PerformanceMessage = Readonly<{
  key: string;
  tone: 'info' | 'warning';
  text: string;
}>;

export function PerformanceNotice({
  messages,
}: Readonly<{ messages: readonly PerformanceMessage[] }>) {
  if (!messages.length) return null;
  return (
    <div data-testid="performance-status" className="min-w-0">
      <Notice tone={messages.some((message) => message.tone === 'warning') ? 'warning' : 'info'}>
        {messages.map((message) => message.text).join(' ')}
      </Notice>
    </div>
  );
}

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
  projectionFailed: boolean;
  selectedMissing: boolean;
  comparisonMissing: boolean;
  qualityFlagged: boolean;
  readinessFailed: boolean;
}>): PerformanceMessage[] {
  const messages: PerformanceMessage[] = [];
  if (sync.error) messages.push({ key: 'sync-error', tone: 'warning', text: sync.error });
  if (readinessFailed)
    messages.push({
      key: 'readiness',
      tone: 'warning',
      text: "Couldn't load data readiness. Check your connection and try again.",
    });
  if (sync.outcome === 'failed')
    messages.push({
      key: 'sync-failed',
      tone: 'warning',
      text: 'Sync finished with errors. Previously imported data is unchanged.',
    });
  if (sync.syncing)
    messages.push({
      key: 'syncing',
      tone: 'info',
      text: 'Sync in progress.',
    });
  if (sync.notice) messages.push({ key: 'sync-notice', tone: 'info', text: sync.notice });
  if (projecting)
    messages.push({
      key: 'projecting',
      tone: 'info',
      text: 'Building this range from imported data…',
    });
  if (projectionFailed)
    messages.push({
      key: 'projection-failed',
      tone: 'warning',
      text: "Couldn't build this range from imported data. Retry to build it again.",
    });
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
