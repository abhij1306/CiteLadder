import { BingPanel } from './bing-panel';
import { DimensionTable, useWarmDimensionTable } from './dimension-table';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { PerformanceDashboard, PerformanceDimension } from '@/lib/api/performance';
import {
  DIMENSION_TABS,
  type PerformanceMetricKey,
  type SearchConsoleDimension,
} from '@/lib/performance/performance';

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
  dimension: SearchConsoleDimension;
  onDimensionChange: (dimension: SearchConsoleDimension) => void;
  snapshotId: string | null;
  compareSnapshotId: string | null;
  dimensionCounts: PerformanceDashboard['dimension_counts'];
  unavailableDimensions: readonly PerformanceDimension[];
  activeMetrics: ReadonlySet<PerformanceMetricKey>;
  selectedLabel: string;
  compareLabel: string;
  hasSearchConsole: boolean;
  hasBing: boolean;
}>) {
  const warm = useWarmDimensionTable(projectId);
  if (!snapshotId || (!hasSearchConsole && !hasBing)) return null;
  return (
    <>
      {hasSearchConsole ? (
        <Section aria-labelledby="performance-breakdowns">
          <SectionHeader>
            <SectionTitle id="performance-breakdowns">Breakdowns</SectionTitle>
          </SectionHeader>
          <Tabs
            value={dimension}
            onValueChange={onDimensionChange}
            items={DIMENSION_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
            ariaLabel="Performance breakdowns"
            spaced
            onIntent={(next) => {
              if (!unavailableDimensions.includes(next))
                warm({ snapshotId, compareSnapshotId }, next);
            }}
          >
            {DIMENSION_TABS.map((tab) => (
              <TabPanel key={tab.value} value={tab.value}>
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
        </Section>
      ) : null}

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
