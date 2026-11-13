import { Database } from 'lucide-react';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { textRole } from '@/components/ui/typography';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { SearchIntelligenceDatasetView } from './search-intelligence-dataset-view';
import { SearchIntelligenceCompetitors } from './search-intelligence-competitors';
import { SearchMetrics, SearchSummaryEvidence } from './search-intelligence-overview';
import { SearchIntelligenceHistory } from './search-intelligence-history';
import { SearchValue } from './search-intelligence-value';
import type { SearchCollection } from './search-intelligence-collection-state';

/**
 * A tab's saved collection: the result the page's control strip chose (the
 * view, website, saved result and filters all ride that strip), or on the
 * Competitors tab with no comparison open, every competitor.
 */
export function SearchIntelligenceCollection({
  collection,
  datasets,
  competitors,
  onSelect,
}: Readonly<{
  collection: SearchCollection;
  datasets: SearchIntelligenceDataset[];
  competitors: SearchIntelligenceReadiness['competitors'];
  onSelect: (dataset: SearchIntelligenceDataset | null) => void;
}>) {
  if (collection.listingCompetitors)
    return (
      <SearchIntelligenceCompetitors
        datasets={datasets}
        competitors={competitors}
        onOpen={onSelect}
      />
    );
  return (
    <Stack gap="workspace" className="min-w-0">
      {collection.tab === 'backlinks' ? (
        <BacklinkMetrics datasets={datasets} targetOrigin={collection.target} />
      ) : null}
      <CollectionResult collection={collection} />
    </Stack>
  );
}

function BacklinkMetrics({
  datasets,
  targetOrigin,
}: Readonly<{ datasets: SearchIntelligenceDataset[]; targetOrigin?: string }>) {
  const summary = datasets.find(
    (item) =>
      item.dataset_kind === 'backlink_summary' &&
      (!targetOrigin || item.target_origin === targetOrigin),
  );
  const history = datasets.find(
    (item) =>
      item.dataset_kind === 'backlink_history' &&
      (!targetOrigin || item.target_origin === targetOrigin),
  );
  return (
    <>
      <SearchMetrics
        metrics={[
          ['Backlinks', summary, 'backlinks'],
          ['Referring domains', summary, 'referring_domains'],
          ['Referring root domains', summary, 'referring_main_domains'],
          ['Domain rank', summary, 'rank'],
        ]}
      />
      {summary ? (
        <p className={textRole('caption')}>
          Referring pages: <SearchValue value={summary.summary.referring_pages} /> · Broken
          backlinks: <SearchValue value={summary.summary.broken_backlinks} /> · Target spam:{' '}
          <SearchValue value={summary.summary.target_spam_score} />
        </p>
      ) : null}
      {history ? <SearchIntelligenceHistory dataset={history} /> : null}
      {summary ? <SearchSummaryEvidence datasets={[summary]} /> : null}
    </>
  );
}

function CollectionResult({ collection }: Readonly<{ collection: SearchCollection }>) {
  const { dataset, title } = collection;
  return (
    <Stack gap="workspace" className="min-w-0">
      {collection.tab === 'competitors' && dataset ? (
        <p className={textRole('itemTitle')}>
          {collection.label(dataset)} compared with {dataset.target_hostname}
        </p>
      ) : null}
      {dataset ? (
        <SearchIntelligenceDatasetView
          key={dataset.id}
          dataset={dataset}
          title={title}
          keywordFilters={collection.keywordDataset ? collection.keywordFilters : undefined}
        />
      ) : (
        <QueryState
          kind="empty"
          icon={Database}
          heading={`No saved ${title.toLowerCase()}`}
          description="Choose it in a new analysis, then review the cost before anything is fetched."
        />
      )}
    </Stack>
  );
}
