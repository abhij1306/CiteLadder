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
 * The filters in the signals table's control band. Each filter is a pressed-
 * state button carrying its signal count and, for a detector's filter, that
 * detector's status when it did not run in full; the hint beside it gives the
 * detector's rule. Data caveats shared by the signals sit in one hint at the
 * end.
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
  const limitations = Array.from(
    new Set(snapshot.signals.flatMap((signal) => signal.limitations).filter(Boolean)),
  );

  return (
    <>
      {FILTER_TABS.map(({ tab, label }) => {
        const count = tabCounts.get(tab) ?? 0;
        // Branded stays hidden while empty, but a tab the user has already
        // selected must remain visible to switch away from.
        if (tab === 'branded' && count === 0 && activeTab !== tab) return null;
        const detector = DEMAND_DETECTORS.find((entry) => entry.tab === tab);
        const state = detector ? detectors[detector.key] : undefined;
        const status = detector ? detectorStatus(state?.state) : null;
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
            {detector ? (
              <InfoHint label={`How the ${detector.label} detector works`}>
                {[detector.rule, ...(state?.limitations ?? [])].join(' ')}
              </InfoHint>
            ) : null}
          </Inline>
        );
      })}
      {limitations.length > 0 ? (
        <InfoHint label="Data caveats">{limitations.join(' ')}</InfoHint>
      ) : null}
    </>
  );
}
