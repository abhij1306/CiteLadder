import type { UseQueryResult } from '@tanstack/react-query';
import type { VisibilityTrendPoint } from '@citeladder/contracts';

import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/tabs';
import {
  metricCodec,
  type TrendLines,
  TrendSection,
} from '@/components/visibility/visibility-trends';
import { VISIBILITY_METRICS } from '@/lib/config/visibility';
import { useUrlState } from '@/lib/navigation/url-state';
import { toChartPoints, toNamedChartPoints } from '@/lib/visibility/trends';

export function CompetitorTrend({
  name,
  query,
}: Readonly<{ name: string; query: UseQueryResult<VisibilityTrendPoint[], unknown> }>) {
  const [metric, setMetric] = useUrlState('metric', metricCodec);
  const lines = (points: readonly VisibilityTrendPoint[], timeZone: string): TrendLines => ({
    name: 'You',
    markName: null,
    lead: toChartPoints(points, metric, timeZone),
    series: [
      {
        label: name,
        values: toNamedChartPoints(points, metric, name, timeZone).map((point) => point.value),
      },
    ],
  });
  return (
    <Section aria-labelledby="competitor-trend">
      <SectionHeader
        actions={
          <SegmentedControl
            ariaLabel="Plotted metric"
            value={metric}
            options={VISIBILITY_METRICS}
            onChange={setMetric}
          />
        }
      >
        <SectionTitle id="competitor-trend">{name} against you</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <TrendSection query={query} metric={metric} lines={lines} keyed={false} lonePoint="list" />
      </SectionContent>
    </Section>
  );
}
