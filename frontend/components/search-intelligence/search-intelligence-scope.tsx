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

/**
 * The saved scope and market, first in the control row's All filters. They
 * pick which saved result the tab reads, so they count as no filter.
 */
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
  if (firstScope)
    filters.push(
      choiceFilter({
        id: 'scope',
        label: 'Saved scope',
        value: scope ?? firstScope,
        // Which saved result to read, not a narrowing: never counted on the button.
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

/**
 * Keyword Research's one control strip, under the tabs: the collection's view
 * switcher, then every picker and filter (scope, market, website, saved
 * result, minimum volume, intent), then one caption line naming what is shown
 * (the website, its market and when it was saved), and the tab's next step at
 * the end. The table below keeps only its search and Export.
 */
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
  /** The scope and market pickers. */
  savedView: FilterDefinition[];
  /** The open tab's collection; absent on the overview. */
  collection?: SearchCollection;
  /** The tab's next step. */
  action?: ReactNode;
}>): FilterBarProps {
  return {
    view: collection ? <CollectionViewControl collection={collection} /> : undefined,
    filters: [...savedView, ...(collection ? collectionFilters(collection) : [])],
    status: <SavedCaption data={data} tab={tab} latest={latest} />,
    actions: action,
  };
}

/** "www.example.com · United States · en · Saved 2 days ago". */
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
        // A saved result without a publish time is still a saved result.
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
