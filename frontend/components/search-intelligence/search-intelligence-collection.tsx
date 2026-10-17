import { useState, type ReactNode } from 'react';
import { Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { textRole } from '@/components/ui/typography';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { SearchIntelligenceDatasetView } from './search-intelligence-dataset-view';
import {
  SearchIntelligenceCompetitors,
  matchesCompetitor,
} from './search-intelligence-competitors';
import { SearchMetrics, SearchSummaryEvidence } from './search-intelligence-overview';
import { SearchIntelligenceHistory } from './search-intelligence-history';
import { SearchValue } from './search-intelligence-value';

type View = { value: string; label: string };

// Each tab opens on its first view, so every tab has one.
const VIEWS: Record<'keywords' | 'backlinks' | 'competitors', readonly [View, ...View[]]> = {
  keywords: [
    { value: 'ranking_keywords', label: 'Ranking keywords' },
    { value: 'organic_pages', label: 'Top pages' },
    { value: 'keyword_suggestions', label: 'Keyword ideas' },
  ],
  backlinks: [
    { value: 'backlinks', label: 'Backlinks' },
    { value: 'referring_domains', label: 'Referring domains' },
    { value: 'destination_pages', label: 'Top linked pages' },
    { value: 'citation_matches', label: 'Citation matches' },
  ],
  competitors: [
    { value: 'missing_keywords', label: 'Missing keywords' },
    { value: 'shared_keywords', label: 'Shared keywords' },
  ],
};

export function SearchIntelligenceCollection({
  tab,
  datasets,
  competitors,
  selected,
  onSelect,
  action,
  onExpand,
}: Readonly<{
  tab: keyof typeof VIEWS;
  datasets: SearchIntelligenceDataset[];
  competitors: SearchIntelligenceReadiness['competitors'];
  selected: SearchIntelligenceDataset | null;
  onSelect: (dataset: SearchIntelligenceDataset | null) => void;
  /** The tab's next step, given the website the reader is looking at. */
  action?: (targetOrigin: string | undefined) => ReactNode;
  onExpand?: () => void;
}>) {
  const [kind, setKind] = useState(VIEWS[tab][0].value);
  const [selectedId, setSelectedId] = useState('');
  const [targetOrigin, setTargetOrigin] = useState('');
  const targets = collectionTargets(datasets, tab);
  const activeTarget =
    targets.find((item) => item.value === targetOrigin)?.value ?? targets[0]?.value;
  const [pendingKind, setPendingKind] = useState<{ kind: string; selection: string } | null>(null);
  const activeKind =
    pendingKind && pendingKind.selection === selected?.id
      ? pendingKind.kind
      : (selected?.dataset_kind ?? kind);
  const candidates = datasets.filter(
    (item) =>
      item.dataset_kind === activeKind &&
      (tab === 'competitors' || item.target_origin === activeTarget),
  );
  const dataset = selectCollectionDataset(candidates, selected, selectedId, tab === 'competitors');
  if (tab === 'competitors' && !selected)
    return (
      <SearchIntelligenceCompetitors
        datasets={datasets}
        competitors={competitors}
        onOpen={onSelect}
      />
    );
  const title = VIEWS[tab].find((item) => item.value === activeKind)?.label ?? 'Saved results';
  function changeKind(value: string) {
    setKind(value);
    setPendingKind(selected ? { kind: value, selection: selected.id } : null);
    if (tab === 'competitors' && selected) {
      const next = datasets.find(
        (item) =>
          item.dataset_kind === value && item.comparison_origin === selected.comparison_origin,
      );
      if (next) {
        setPendingKind(null);
        onSelect(next);
      }
    }
  }
  const label = (item: SearchIntelligenceDataset) => {
    if (
      item.dataset_kind === 'keyword_suggestions' &&
      item.acquisition &&
      typeof item.acquisition === 'object' &&
      'keyword' in item.acquisition
    )
      return `${item.target_hostname} · ${String(item.acquisition.keyword)}`;
    const competitor = competitors.find((entry) =>
      matchesCompetitor(item.comparison_origin, entry.registrable_domain),
    );
    return competitor?.label ?? item.target_hostname;
  };
  return (
    <div className="grid min-w-0 gap-4">
      {tab === 'backlinks' ? (
        <BacklinkMetrics datasets={datasets} targetOrigin={activeTarget} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {tab === 'competitors' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPendingKind(null);
                setSelectedId('');
                onSelect(null);
              }}
            >
              All competitors
            </Button>
          ) : null}
          <SegmentedControl
            ariaLabel={`${tab} view`}
            value={activeKind}
            onChange={changeKind}
            options={VIEWS[tab].filter(
              (item) =>
                item.value !== 'citation_matches' ||
                datasets.some((entry) => entry.dataset_kind === item.value),
            )}
          />
          <CollectionTarget
            tab={tab}
            options={targets}
            value={activeTarget}
            onChange={setTargetOrigin}
          />
          {candidates.length > 1 ? (
            <Select
              ariaLabel={tab === 'competitors' ? 'Competitor' : 'Saved results'}
              value={dataset?.id}
              onValueChange={(id) => {
                setSelectedId(id);
                if (tab === 'competitors')
                  onSelect(candidates.find((item) => item.id === id) ?? null);
              }}
              options={candidates.map((item) => ({ value: item.id, label: label(item) }))}
            />
          ) : null}
        </div>
        {action?.(activeTarget)}
      </div>
      <CollectionResult
        dataset={dataset}
        title={title}
        comparison={tab === 'competitors'}
        label={label}
        onExpand={onExpand}
      />
    </div>
  );
}

function collectionTargets(datasets: SearchIntelligenceDataset[], tab: keyof typeof VIEWS) {
  const kinds = new Set(VIEWS[tab].map((item) => item.value));
  if (tab === 'backlinks') {
    kinds.add('backlink_summary');
    kinds.add('backlink_history');
  }
  return [
    ...new Map(
      datasets
        .filter((item) => kinds.has(item.dataset_kind))
        .map((item) => [
          item.target_origin,
          { value: item.target_origin, label: item.target_hostname },
        ]),
    ).values(),
  ];
}

function CollectionTarget({
  tab,
  options,
  value,
  onChange,
}: Readonly<{
  tab: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string) => void;
}>) {
  if (tab === 'competitors' || !options.length) return null;
  return (
    <Select ariaLabel="Saved target" options={options} value={value} onValueChange={onChange} />
  );
}

function selectCollectionDataset(
  candidates: SearchIntelligenceDataset[],
  selected: SearchIntelligenceDataset | null,
  selectedId: string,
  comparison: boolean,
) {
  if (comparison)
    return candidates.find((item) => item.comparison_origin === selected?.comparison_origin);
  return candidates.find((item) => item.id === selectedId) ?? candidates[0];
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

function CollectionResult({
  dataset,
  title,
  comparison,
  label,
  onExpand,
}: Readonly<{
  dataset?: SearchIntelligenceDataset;
  title: string;
  comparison: boolean;
  label: (dataset: SearchIntelligenceDataset) => string;
  onExpand?: () => void;
}>) {
  return (
    <div className="grid min-w-0 gap-4">
      {comparison && dataset ? (
        <p className={textRole('itemTitle')}>
          {label(dataset)} compared with {dataset.target_hostname}
        </p>
      ) : null}
      {dataset ? (
        <SearchIntelligenceDatasetView
          key={dataset.id}
          dataset={dataset}
          title={title}
          onExpand={onExpand}
        />
      ) : (
        <EmptyState
          icon={Database}
          heading={`No saved ${title.toLowerCase()}`}
          description="Choose it in a new analysis, then review the cost before anything is fetched."
        />
      )}
    </div>
  );
}
