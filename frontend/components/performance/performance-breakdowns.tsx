import { BingPanel } from './bing-panel';
import { DimensionTable, useWarmDimensionTable } from './dimension-table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { PerformanceDashboard, PerformanceDimension } from '@/lib/api/performance';
import {
  DIMENSION_TABS,
  type PerformanceMetricKey,
  type SearchConsoleDimension,
} from '@/lib/performance/performance';

/**
 * Everything below the chart: the six Search Console breakdowns, and Bing's
 * own panel beneath them.
 *
 * One component so the screen above stays a composition of parts rather than
 * one long conditional render. The two engines stay visibly apart here for
 * the same reason they stay apart in the projection: they measure different
 * populations, so a Bing row must never be mistakable for a Search Console
 * one.
 */
export function PerformanceBreakdowns({
  projectId,
  dimension,
  onDimensionChange,
  snapshotId,
  compareSnapshotId,
  dimensionCounts,
  unavailableDimensions,
  activeMetrics,
  selectedLabel,
  compareLabel,
  hasSearchConsole,
  hasBing,
}: Readonly<{
  projectId: string;
  /**
   * Which Search Console tab is open. Narrower than PerformanceDimension on
   * purpose: a Bing dimension names no tab here, so it would render a tab row
   * with nothing selected and every panel closed.
   */
  dimension: SearchConsoleDimension;
  onDimensionChange: (dimension: SearchConsoleDimension) => void;
  /** Null while the selected range has no persisted projection. */
  snapshotId: string | null;
  compareSnapshotId: string | null;
  /** The snapshot's persisted row count per dimension. */
  dimensionCounts: PerformanceDashboard['dimension_counts'];
  unavailableDimensions: readonly PerformanceDimension[];
  activeMetrics: ReadonlySet<PerformanceMetricKey>;
  selectedLabel: string;
  compareLabel: string;
  /** Whether this snapshot contains Search Console totals for the selected window. */
  hasSearchConsole: boolean;
  /** Whether the project actually has a Bing connection at all. */
  hasBing: boolean;
}>) {
  const warm = useWarmDimensionTable(projectId);
  // A missing snapshot is a prerequisite or a range projection, not six empty
  // tables. The owner stays mounted above us to continue the projection task.
  if (!snapshotId || (!hasSearchConsole && !hasBing)) return null;
  return (
    <>
      {hasSearchConsole ? (
        <Tabs
          value={dimension}
          onValueChange={onDimensionChange}
          items={DIMENSION_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
          ariaLabel="Performance breakdowns"
          spaced
          // The tab row heads the table card, so it spans the full width
          // rather than hugging six labels and leaving dead space to the right.
          fill
          onIntent={(next) => {
            if (!unavailableDimensions.includes(next))
              warm({ snapshotId, compareSnapshotId }, next);
          }}
        >
          {DIMENSION_TABS.map((tab) => (
            <TabPanel key={tab.value} value={tab.value} className="focus-ring">
              {dimension === tab.value ? (
                <DimensionTable
                  projectId={projectId}
                  dimension={tab.value}
                  snapshotId={snapshotId}
                  compareSnapshotId={compareSnapshotId}
                  measuredRows={dimensionCounts[tab.value]}
                  activeMetrics={activeMetrics}
                  unavailable={unavailableDimensions.includes(tab.value)}
                  selectedLabel={selectedLabel}
                  compareLabel={compareLabel}
                />
              ) : null}
            </TabPanel>
          ))}
        </Tabs>
      ) : null}

      {/* Bing rides BELOW the Search Console tables, never among them, and
          only when the project has a Bing connection: "never imported" and
          "measured nothing" are different answers, and an always-present
          empty panel would state the second while meaning the first. */}
      {hasBing ? (
        <BingPanel
          projectId={projectId}
          snapshotId={snapshotId}
          compareSnapshotId={compareSnapshotId}
          dimensionCounts={dimensionCounts}
          selectedLabel={selectedLabel}
          compareLabel={compareLabel}
        />
      ) : null}
    </>
  );
}
