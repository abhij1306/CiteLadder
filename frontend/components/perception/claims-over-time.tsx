import type { AccuracyResponse } from '@citeladder/contracts/fact-checking';

import { SectionContent, TitledSection } from '@/components/ui/section';
import { StackedBarChart } from '@/components/ui/stacked-bar-chart';
import { formatShortDate, formatWindowDate } from '@/lib/format';
import { VERDICT_LABELS } from '@/lib/visibility/accuracy';

const STACK = [
  { key: 'supported', fill: 'fill-positive bg-positive' },
  { key: 'contradicted', fill: 'fill-current text-negative bg-negative' },
  { key: 'inconclusive', fill: 'fill-data-other bg-data-other' },
] as const;
const SERIES = STACK.map(({ key, fill }) => ({ name: VERDICT_LABELS[key], fill }));

export function ClaimsOverTime({ trend }: Readonly<{ trend: AccuracyResponse['trend'] }>) {
  const bars = trend.map((point, index) => {
    const day = point.completed_at.slice(0, 10);
    return {
      key: point.audit_id,
      label: formatWindowDate(day),
      axisLabel: formatShortDate(day),
      values: STACK.map(({ key }) => point.score.coverage[key]),
      breakBefore: index > 0 && !point.comparable,
    };
  });
  return (
    <TitledSection title="Claims over time">
      <SectionContent>
        <StackedBarChart
          label="Claims over time"
          series={SERIES}
          bars={bars}
          breakNote="Not comparable with the run before: its templates, metrics or facts changed"
        />
      </SectionContent>
    </TitledSection>
  );
}
