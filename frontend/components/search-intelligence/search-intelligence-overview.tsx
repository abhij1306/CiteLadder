import type { ReactNode } from 'react';
import { Database } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { EmptyState } from '@/components/ui/empty-state';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { MetricGroup, MetricItem } from '@/components/ui/workspace';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { SEARCH_DATASET_LABELS } from '@/lib/config/search-intelligence';
import { SearchIntelligenceCompetitors } from './search-intelligence-competitors';
import { SearchValue } from './search-intelligence-value';

/** A metric is read from one dataset's summary; no dataset means it was never fetched. */
export type SearchMetric = readonly [
  label: string,
  dataset: SearchIntelligenceDataset | undefined,
  field: string,
];

export function SearchMetrics({ metrics }: Readonly<{ metrics: readonly SearchMetric[] }>) {
  return (
    <Card>
      <CardContent>
        <MetricGroup>
          {metrics.map(([label, dataset, field]) => (
            <MetricItem
              key={label}
              label={label}
              value={<SearchValue value={dataset?.summary[field]} fetched={Boolean(dataset)} />}
            />
          ))}
        </MetricGroup>
      </CardContent>
    </Card>
  );
}

export function SearchIntelligenceOverview({
  datasets,
  competitors,
  ownedHostname,
  onOpen,
  firstRun,
}: Readonly<{
  datasets: SearchIntelligenceDataset[];
  competitors: SearchIntelligenceReadiness['competitors'];
  ownedHostname: string;
  onOpen: (dataset: SearchIntelligenceDataset) => void;
  /** The action that starts the first analysis. */
  firstRun: ReactNode;
}>) {
  const footprint = datasets.find(
    (item) => item.dataset_kind === 'footprint' && item.target_hostname === ownedHostname,
  );
  const backlinks = datasets.find(
    (item) => item.dataset_kind === 'backlink_summary' && item.target_hostname === ownedHostname,
  );
  if (!footprint && !backlinks)
    return (
      <EmptyState
        icon={Database}
        heading="See where you rank and where competitors outrank you"
        description="The first analysis reads your keyword footprint and rankings, plus the keywords one competitor ranks for and you don’t. You see the exact cost before anything is fetched."
        action={firstRun}
      />
    );
  const share = footprint?.summary.top_10_percentage;
  return (
    <Stack gap="workspace" className="min-w-0">
      <SearchMetrics
        metrics={[
          ['Organic keywords', footprint, 'organic_keywords'],
          ['Estimated monthly traffic', footprint, 'estimated_monthly_traffic'],
          ['Top-10 keywords', footprint, 'top_10_keywords'],
          ['Referring domains', backlinks, 'referring_domains'],
          ['Backlinks', backlinks, 'backlinks'],
        ]}
      />
      <SearchIntelligenceCompetitors
        datasets={datasets}
        competitors={competitors}
        onOpen={onOpen}
      />
      {footprint ? (
        <p className={textRole('caption')}>
          Top-10 share of your ranking keywords: <SearchValue value={share} digits={2} />
          {share == null ? '' : '%'}
        </p>
      ) : null}
      <SearchSummaryEvidence
        datasets={[footprint, backlinks].filter((item) => item !== undefined)}
      />
      <p className={textRole('caption')}>
        Provider estimates and observed rankings are separate from first-party Search Demand data.
      </p>
    </Stack>
  );
}

export function SearchSummaryEvidence({
  datasets,
}: Readonly<{ datasets: SearchIntelligenceDataset[] }>) {
  return (
    <details className={textRole('caption')}>
      <summary>Metric definitions and sources</summary>
      <Stack gap="tight" className="pt-2">
        <p>
          Organic positions exclude other result types; absolute position includes them. Estimated
          traffic and CPC (USD) are provider estimates. Difficulty is organic keyword difficulty.
          DataForSEO Rank uses a 0–100 scale for the named object. Referring domains and referring
          root domains are distinct totals.
        </p>
        <ul className="grid gap-1">
          {datasets.map((dataset) => (
            <li key={dataset.id}>
              {SEARCH_DATASET_LABELS[dataset.dataset_kind] ?? dataset.dataset_kind} for{' '}
              {dataset.target_hostname}, collected{' '}
              <DisplayTime
                value={dataset.collection_ended_at}
                dateOnly
                fallback="at an unknown time"
              />
            </li>
          ))}
        </ul>
      </Stack>
    </details>
  );
}
