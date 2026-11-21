import { Disclosure } from '@/components/ui/disclosure';
import { DisplayTime } from '@/components/ui/display-time';
import { Stack } from '@/components/ui/layout';
import { Section } from '@/components/ui/section';
import { textRole } from '@/components/ui/typography';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { Database } from '@/lib/icons';
import { SEARCH_DATASET_LABELS } from '@/lib/config/search-intelligence';
import { SearchIntelligenceCompetitors } from './search-intelligence-competitors';
import { SearchValue } from './search-intelligence-value';
import { StateBlock } from '@/components/ui/state-block';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';

export type SearchMetric = readonly [
  label: string,
  dataset: SearchIntelligenceDataset | undefined,
  field: string,
  options?: Readonly<{ asOf?: boolean; sub?: FigureSegment['sub'] }>,
];

export function SearchMetrics({
  metrics,
  label,
}: Readonly<{ metrics: readonly SearchMetric[]; label?: string }>) {
  return (
    <FigureStrip
      label={label}
      segments={metrics.map(([label, dataset, field, options]) => ({
        key: label,
        label,
        value: <SearchValue value={dataset?.summary[field]} fetched={Boolean(dataset)} />,
        sub:
          options?.sub ??
          (options?.asOf && dataset?.collection_ended_at ? (
            <>
              as of <DisplayTime value={dataset.collection_ended_at} dateOnly />
            </>
          ) : undefined),
      }))}
    />
  );
}

export function SearchIntelligenceOverview({
  datasets,
  competitors,
  ownedHostname,
  onOpen,
}: Readonly<{
  datasets: SearchIntelligenceDataset[];
  competitors: SearchIntelligenceReadiness['competitors'];
  ownedHostname: string;
  onOpen: (dataset: SearchIntelligenceDataset) => void;
}>) {
  const footprint = datasets.find(
    (item) => item.dataset_kind === 'footprint' && item.target_hostname === ownedHostname,
  );
  const backlinks = datasets.find(
    (item) => item.dataset_kind === 'backlink_summary' && item.target_hostname === ownedHostname,
  );
  if (!footprint && !backlinks)
    return (
      <StateBlock
        kind="empty"
        icon={Database}
        heading="See where you rank and where competitors outrank you"
      />
    );
  const share = footprint?.summary.top_10_percentage;
  return (
    <Stack gap="workspace" className="min-w-0">
      <SearchMetrics
        label="Your search footprint"
        metrics={[
          ['Organic keywords', footprint, 'organic_keywords', { asOf: true }],
          ['Estimated monthly traffic', footprint, 'estimated_monthly_traffic'],
          [
            'Top-10 keywords',
            footprint,
            'top_10_keywords',
            {
              sub:
                footprint && share != null ? (
                  <>
                    <SearchValue value={share} digits={1} />% of ranking keywords
                  </>
                ) : undefined,
            },
          ],
          ['Referring domains', backlinks, 'referring_domains', { asOf: true }],
          ['Backlinks', backlinks, 'backlinks', { asOf: true }],
        ]}
      />
      <SearchIntelligenceCompetitors
        datasets={datasets}
        competitors={competitors}
        onOpen={onOpen}
      />
      <SearchSummaryEvidence
        datasets={[footprint, backlinks].filter((item) => item !== undefined)}
      />
    </Stack>
  );
}

export function SearchSummaryEvidence({
  datasets,
}: Readonly<{ datasets: SearchIntelligenceDataset[] }>) {
  return (
    <Section aria-label="Metric definitions and sources">
      <Stack gap="item">
        <Disclosure title="Metric definitions and sources">
          <p className={textRole('caption')}>
            Organic positions exclude other result types; absolute position includes them. Estimated
            traffic and CPC (USD) are provider estimates. Difficulty is organic keyword difficulty.
            DataForSEO Rank uses a 0–100 scale for the named object. Referring domains and referring
            root domains are distinct totals.
          </p>
          <Stack as="ul" gap="tight" className={textRole('caption')}>
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
          </Stack>
        </Disclosure>
      </Stack>
    </Section>
  );
}
