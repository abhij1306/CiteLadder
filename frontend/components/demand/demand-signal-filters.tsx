'use client';

import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Inline } from '@/components/ui/layout';
import type { DemandSnapshot } from '@/lib/api/demand';
import { DEMAND_DETECTORS } from '@/lib/config/demand';
import { detectorStates, FILTER_TABS, type FilterTab } from '@/lib/demand/signals';

/**
 * A detector's state in words, or null when it ran in full. A detector the
 * snapshot did not report says so rather than passing as active.
 */
function detectorStatus(state: string | undefined): string | null {
  switch (state) {
    case 'available':
      return null;
    case 'partial':
      return 'Partial';
    case 'insufficient_history':
      return 'Needs more history';
    case 'unavailable':
      return 'Unavailable';
    case undefined:
      return 'Not reported';
    default:
      return state.replaceAll('_', ' ');
  }
}

/**
 * The status of a filter listing several detectors' signals: theirs when they
 * agree, else partial, so the status always describes every signal counted.
 */
function filterStatus(states: readonly (string | undefined)[]): string | null {
  const statuses = new Set(states.map(detectorStatus));
  const [only] = statuses;
  if (statuses.size === 1) return only ?? null;
  return 'Partial';
}

type Detector = (typeof DEMAND_DETECTORS)[number];

/** The hint for a filter: each detector's rule, then what limited it. */
function DetectorHint({
  detectors,
  states,
}: Readonly<{ detectors: readonly Detector[]; states: ReturnType<typeof detectorStates> }>) {
  const several = detectors.length > 1;
  const label = several
    ? `How the ${detectors.map((detector) => detector.label).join(' and ')} detectors work`
    : `How the ${detectors[0]?.label} detector works`;
  const text = detectors
    .map((detector) =>
      [
        several ? `${detector.label}: ${detector.rule}` : detector.rule,
        ...(states[detector.key]?.limitations ?? []),
      ].join(' '),
    )
    .join(' ');
  return <InfoHint label={label}>{text}</InfoHint>;
}

/**
 * The filters in the signals table's control band. Each filter is a pressed-
 * state button carrying its signal count and, for a detector's filter, the
 * status of the detectors it counts when they did not run in full; the hint
 * beside it gives each detector's rule.
 */
export function DemandSignalFilters({
  snapshot,
  activeTab,
  onTabChange,
  tabCounts,
}: Readonly<{
  snapshot: DemandSnapshot;
  activeTab: FilterTab;
  onTabChange: (tab: FilterTab) => void;
  tabCounts: ReadonlyMap<FilterTab, number>;
}>) {
  const detectors = detectorStates(snapshot.summary);

  return (
    <>
      {FILTER_TABS.map(({ tab, label }) => {
        const count = tabCounts.get(tab) ?? 0;
        // Branded stays hidden while empty, but a tab the user has already
        // selected must remain visible to switch away from.
        if (tab === 'branded' && count === 0 && activeTab !== tab) return null;
        const counted = DEMAND_DETECTORS.filter((entry) => entry.tab === tab);
        const status = counted.length
          ? filterStatus(counted.map((entry) => detectors[entry.key]?.state))
          : null;
        return (
          <Inline as="span" key={tab} gap="tight">
            <Button
              variant="secondary"
              aria-pressed={activeTab === tab}
              onClick={() => onTabChange(tab)}
            >
              {label}
              {status ? <span className="text-muted">{` · ${status}`}</span> : null}
              <span className="text-muted tabular-nums">{count}</span>
            </Button>
            {counted.length ? <DetectorHint detectors={counted} states={detectors} /> : null}
          </Inline>
        );
      })}
    </>
  );
}

/**
 * Data caveats shared by the signals, behind one hint on the summary line:
 * at the end of the filter strip it sat beside the last filter's own hint
 * and read as a second hint for that filter.
 */
export function DemandDataCaveats({ snapshot }: Readonly<{ snapshot: DemandSnapshot }>) {
  const limitations = Array.from(
    new Set(snapshot.signals.flatMap((signal) => signal.limitations).filter(Boolean)),
  );
  return limitations.length > 0 ? (
    <InfoHint label="Data caveats">{limitations.join(' ')}</InfoHint>
  ) : null;
}
