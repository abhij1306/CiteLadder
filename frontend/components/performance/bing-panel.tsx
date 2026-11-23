import { useState } from 'react';

import { DimensionTable, useWarmDimensionTable } from './dimension-table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import type { PerformanceDashboard, PerformanceDimension } from '@/lib/api/performance';
import { BING_DIMENSION_TABS } from '@/lib/performance/performance';

/**
 * Bing Webmaster Tools, in a panel of its own.
 *
 * Bing is a SECOND search engine measuring a different population, so its
 * clicks and impressions are never added to the Search Console cards, never
 * drawn on the same chart, and never given a column on a Search Console
 * table. Summing them would silently change what every existing number means
 * and would leave CTR and average position undefined across two engines.
 *
 * The panel renders only when the project actually has a Bing connection:
 * "we never imported Bing" and "Bing measured nothing" are different answers
 *, and an always-present empty panel would state the second
 * while meaning the first.
 */
export function BingPanel({
  projectId,
  snapshotId,
  compareSnapshotId,
  dimensionCounts,
  selectedLabel,
  compareLabel,
}: Readonly<{
  projectId: string;
  snapshotId: string;
  compareSnapshotId: string | null;
  dimensionCounts: PerformanceDashboard['dimension_counts'];
  selectedLabel: string;
  compareLabel: string;
}>) {
  const [dimension, setDimension] = useState<PerformanceDimension>('bing_query');
  const warm = useWarmDimensionTable(projectId);

  return (
    <Section aria-label="Bing performance" data-testid="bing-panel">
      <SectionHeader>
        <SectionTitle>Bing</SectionTitle>
      </SectionHeader>
      <Tabs
        value={dimension}
        onValueChange={setDimension}
        items={BING_DIMENSION_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
        ariaLabel="Bing breakdowns"
        spaced
        onIntent={(next) => warm({ snapshotId, compareSnapshotId }, next)}
      >
        {BING_DIMENSION_TABS.map((tab) => (
          <TabPanel key={tab.value} value={tab.value}>
            {dimension === tab.value ? (
              <DimensionTable
                projectId={projectId}
                dimension={tab.value}
                snapshotId={snapshotId}
                compareSnapshotId={compareSnapshotId}
                measuredRows={dimensionCounts[tab.value]}
                selectedLabel={selectedLabel}
                compareLabel={compareLabel}
              />
            ) : null}
          </TabPanel>
        ))}
      </Tabs>
    </Section>
  );
}
