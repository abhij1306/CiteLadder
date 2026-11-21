import type { ReactNode } from 'react';

import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { DisplayTime } from '@/components/ui/display-time';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { searchScopeLabel, searchMarketLabel } from '@/lib/config/search-intelligence';
import { CollectionViewControl, collectionFilters } from './search-intelligence-controls';
import type { SearchCollection } from './search-intelligence-collection-state';

export function savedViewFilters({
  scopes,
  scope,
  onScope,
  markets,
  market,
  onMarket,
  tab,
}: Readonly<{
  scopes: string[];
  scope: string | undefined;
  onScope: (value: string) => void;
  markets: { value: string; label: string }[];
  market: string | undefined;
  onMarket: (value: string) => void;
  tab: string;
}>): FilterDefinition[] {
  const filters: FilterDefinition[] = [];
  const [firstScope] = scopes;
  if (firstScope && scopes.length > 1)
    filters.push(
      choiceFilter({
        id: 'scope',
        label: 'Saved scope',
        value: scope ?? firstScope,
        defaultValue: scope ?? firstScope,
        groups: [{ options: scopes.map((value) => ({ value, label: searchScopeLabel(value) })) }],
        onChange: onScope,
      }),
    );
  const [firstMarket] = markets;
  if (firstMarket && markets.length > 1 && tab !== 'backlinks')
    filters.push(
      choiceFilter({
        id: 'market',
        label: 'Saved market',
        value: market ?? firstMarket.value,
        defaultValue: market ?? firstMarket.value,
        groups: [{ options: markets }],
        onChange: onMarket,
      }),
    );
  return filters;
}

export function scopeControls({
  data,
  tab,
  latest,
  savedView,
  collection,
  action,
}: Readonly<{
  data: SearchIntelligenceReadiness;
  tab: string;
  latest?: SearchIntelligenceDataset;
  savedView: FilterDefinition[];
  collection?: SearchCollection;
  action?: ReactNode;
}>): FilterBarProps {
  return {
    view: collection ? <CollectionViewControl collection={collection} /> : undefined,
    filters: [...savedView, ...(collection ? collectionFilters(collection) : [])],
    status: <SavedCaption data={data} tab={tab} latest={latest} />,
    actions: action,
  };
}

function SavedCaption({
  data,
  tab,
  latest,
}: Readonly<{
  data: SearchIntelligenceReadiness;
  tab: string;
  latest?: SearchIntelligenceDataset;
}>) {
  return (
    <span>
      <span>{latest?.target_hostname ?? data.owned_targets[0]?.hostname}</span>
      {' · '}
      <span>
        {tab === 'backlinks' ? 'All referring countries' : savedMarketLabel(latest, data)}
      </span>
      {' · '}
      {latest?.published_at ? (
        <>
          Saved <DisplayTime value={latest.published_at} />
        </>
      ) : (
        (latest && 'Save time unavailable') || 'No saved analysis'
      )}
    </span>
  );
}

function savedMarketLabel(
  dataset: SearchIntelligenceDataset | undefined,
  data: SearchIntelligenceReadiness,
) {
  const market = dataset ? dataset.location_code : data.preferences.location_code;
  const language = dataset ? dataset.language_code : data.preferences.language_code;
  return `${searchMarketLabel(market, data.markets)} · ${language || 'Language not set'}`;
}
