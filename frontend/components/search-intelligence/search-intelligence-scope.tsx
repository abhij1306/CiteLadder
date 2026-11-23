import type { ReactNode } from 'react';

import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { searchScopeLabel } from '@/lib/config/search-intelligence';
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
  savedView,
  collection,
  action,
}: Readonly<{
  savedView: FilterDefinition[];
  collection?: SearchCollection;
  action?: ReactNode;
}>): FilterBarProps {
  return {
    view: collection ? <CollectionViewControl collection={collection} /> : undefined,
    filters: [...savedView, ...(collection ? collectionFilters(collection) : [])],
    actions: action,
  };
}
