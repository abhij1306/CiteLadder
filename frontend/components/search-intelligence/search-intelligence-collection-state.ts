import { useState } from 'react';

import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { searchDatasetTraits } from '@citeladder/contracts/search-intelligence';
import { matchesCompetitor } from './search-intelligence-competitors';

type View = { value: string; label: string };

/** A Keyword Research tab that shows saved collections (every tab but Overview). */
export type CollectionTab = 'keywords' | 'backlinks' | 'competitors';

// Each tab opens on its first view, so every tab has one.
const VIEWS: Record<CollectionTab, readonly [View, ...View[]]> = {
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

/** The table filters only keyword datasets take; a new dataset starts unfiltered. */
export type KeywordFilterValues = Readonly<{ minVolume: string; intent: string }>;

const NO_KEYWORD_FILTERS: KeywordFilterValues = { minVolume: '', intent: '' };

/** What one tab remembers: its view, website, saved result and filters. */
type TabState = Readonly<{
  kind: string;
  selectedId: string;
  targetOrigin: string;
  /** A view chosen for a competitor that has no saved dataset of that kind. */
  pendingKind: { kind: string; selection: string } | null;
  filters: KeywordFilterValues & { datasetId: string | undefined };
}>;

function initialState(tab: CollectionTab): TabState {
  return {
    kind: VIEWS[tab][0].value,
    selectedId: '',
    targetOrigin: '',
    pendingKind: null,
    filters: { ...NO_KEYWORD_FILTERS, datasetId: undefined },
  };
}

function collectionTargets(datasets: readonly SearchIntelligenceDataset[], tab: CollectionTab) {
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

function selectCollectionDataset(
  candidates: readonly SearchIntelligenceDataset[],
  selected: SearchIntelligenceDataset | null,
  selectedId: string,
  comparison: boolean,
) {
  if (comparison)
    return candidates.find((item) => item.comparison_origin === selected?.comparison_origin);
  return candidates.find((item) => item.id === selectedId) ?? candidates[0];
}

/** A saved dataset's name in a picker: its keyword seed, its competitor, or its website. */
function datasetLabel(
  item: SearchIntelligenceDataset,
  competitors: SearchIntelligenceReadiness['competitors'],
) {
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
}

/**
 * The state of the collection a tab shows — its view, website, saved result
 * and keyword filters — held by the page, because its controls ride the
 * page's one control strip while the result renders in the tab's panel.
 * Each tab keeps its own, so returning to a tab finds it as it was left.
 */
export function useSearchCollection({
  tab,
  ...input
}: Readonly<
  Omit<CollectionInput, 'tab' | 'state' | 'patch'> & {
    /** The open tab, or null on the overview, which shows no collection. */
    tab: CollectionTab | null;
  }
>) {
  const [states, setStates] = useState<Partial<Record<CollectionTab, TabState>>>({});
  if (tab === null) return null;
  const patch = (next: Partial<TabState>) =>
    setStates((current) => ({
      ...current,
      [tab]: { ...(current[tab] ?? initialState(tab)), ...next },
    }));
  return collectionView({ ...input, tab, state: states[tab] ?? initialState(tab), patch });
}

export type SearchCollection = ReturnType<typeof collectionView>;

type CollectionInput = Readonly<{
  tab: CollectionTab;
  state: TabState;
  patch: (next: Partial<TabState>) => void;
  datasets: readonly SearchIntelligenceDataset[];
  competitors: SearchIntelligenceReadiness['competitors'];
  /** The competitor comparison open on the Competitors tab. */
  selected: SearchIntelligenceDataset | null;
  onSelect: (dataset: SearchIntelligenceDataset | null) => void;
}>;

function collectionView({
  tab,
  state,
  patch,
  datasets,
  competitors,
  selected,
  onSelect,
}: CollectionInput) {
  const comparison = tab === 'competitors' ? selected : null;
  const targets = collectionTargets(datasets, tab);
  const target =
    targets.find((item) => item.value === state.targetOrigin)?.value ?? targets[0]?.value;
  const kind =
    state.pendingKind && state.pendingKind.selection === comparison?.id
      ? state.pendingKind.kind
      : (comparison?.dataset_kind ?? state.kind);
  const candidates = datasets.filter(
    (item) =>
      item.dataset_kind === kind && (tab === 'competitors' || item.target_origin === target),
  );
  const dataset = selectCollectionDataset(
    candidates,
    comparison,
    state.selectedId,
    tab === 'competitors',
  );

  function changeKind(value: string) {
    const next = comparison
      ? datasets.find(
          (item) =>
            item.dataset_kind === value && item.comparison_origin === comparison.comparison_origin,
        )
      : undefined;
    patch({
      kind: value,
      pendingKind: comparison && !next ? { kind: value, selection: comparison.id } : null,
    });
    if (next) onSelect(next);
  }

  const filters = state.filters.datasetId === dataset?.id ? state.filters : NO_KEYWORD_FILTERS;
  const setFilters = (next: Partial<KeywordFilterValues>) =>
    patch({ filters: { ...filters, ...next, datasetId: dataset?.id } });

  return {
    tab,
    /** The Competitors tab with no comparison open lists the competitors instead. */
    listingCompetitors: tab === 'competitors' && !comparison,
    views: VIEWS[tab].filter(
      (item) =>
        item.value !== 'citation_matches' ||
        datasets.some((entry) => entry.dataset_kind === item.value),
    ),
    kind,
    changeKind,
    title: VIEWS[tab].find((item) => item.value === kind)?.label ?? 'Saved results',
    targets: tab === 'competitors' ? [] : targets,
    target,
    changeTarget: (value: string) => patch({ targetOrigin: value }),
    candidates,
    dataset,
    changeDataset: (id: string) => {
      patch({ selectedId: id });
      if (tab === 'competitors') onSelect(candidates.find((item) => item.id === id) ?? null);
    },
    showAllCompetitors: () => {
      patch({ pendingKind: null, selectedId: '' });
      onSelect(null);
    },
    label: (item: SearchIntelligenceDataset) => datasetLabel(item, competitors),
    keywordDataset: Boolean(dataset && searchDatasetTraits(dataset.dataset_kind)?.keyword),
    keywordFilters: filters,
    setMinVolume: (minVolume: string) => setFilters({ minVolume }),
    setIntent: (intent: string) => setFilters({ intent }),
  };
}
