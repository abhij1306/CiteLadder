import type { ReactNode } from 'react';
import { Select } from '@/components/ui/select';
import { DisplayTime } from '@/components/ui/display-time';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { textRole } from '@/components/ui/typography';
import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { searchScopeLabel, searchMarketLabel } from '@/lib/config/search-intelligence';

export function SavedViewControls({
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
}>) {
  return (
    <>
      {scopes.length ? (
        <Select
          ariaLabel="Saved scope"
          value={scope}
          onValueChange={onScope}
          options={scopes.map((value) => ({ value, label: searchScopeLabel(value) }))}
        />
      ) : null}
      {markets.length > 1 && tab !== 'backlinks' ? (
        <Select
          ariaLabel="Saved market"
          value={market}
          onValueChange={onMarket}
          options={markets}
        />
      ) : null}
    </>
  );
}

/** The saved view's scope, for `PageShell`'s control band. */
export function scopeControls({
  data,
  tab,
  latest,
  marketControl,
}: Readonly<{
  data: SearchIntelligenceReadiness;
  tab: string;
  latest?: SearchIntelligenceDataset;
  marketControl?: ReactNode;
}>): FilterBarProps {
  return {
    filters: (
      <>
        <span className={textRole('itemTitle')}>
          {latest?.target_hostname ?? data.owned_targets[0]?.hostname}
        </span>
        <span className={textRole('caption')}>
          {tab === 'backlinks' ? 'All referring countries' : savedMarketLabel(latest, data)}
        </span>
        {marketControl}
      </>
    ),
    actions: (
      <span className={textRole('caption')}>
        {latest?.published_at ? (
          <>
            Saved <DisplayTime value={latest.published_at} />
          </>
        ) : (
          'No saved analysis'
        )}
      </span>
    ),
  };
}

function savedMarketLabel(
  dataset: SearchIntelligenceDataset | undefined,
  data: SearchIntelligenceReadiness,
) {
  const market = dataset ? dataset.location_code : data.preferences.location_code;
  const language = dataset ? dataset.language_code : data.preferences.language_code;
  return `${searchMarketLabel(market)} · ${language || 'Language not set'}`;
}
