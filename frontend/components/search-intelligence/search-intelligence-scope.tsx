import type { ReactNode } from 'react';
import { Select } from '@/components/ui/select';
import { DisplayTime } from '@/components/ui/display-time';
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

export function ScopeBand({
  data,
  tab,
  latest,
  marketControl,
}: Readonly<{
  data: SearchIntelligenceReadiness;
  tab: string;
  latest?: SearchIntelligenceDataset;
  marketControl?: ReactNode;
}>) {
  return (
    <div className="flex w-full flex-wrap items-center gap-3 py-2 min-[981px]:py-0">
      <span className={textRole('itemTitle')}>
        {latest?.target_hostname ?? data.owned_targets[0]?.hostname}
      </span>
      <span className={textRole('caption')}>
        {tab === 'backlinks' ? 'All referring countries' : savedMarketLabel(latest, data)}
      </span>
      {marketControl}
      <span className={textRole('caption', 'ml-auto')}>
        {latest?.published_at ? (
          <>
            Saved <DisplayTime value={latest.published_at} />
          </>
        ) : (
          'No saved analysis'
        )}
      </span>
    </div>
  );
}

function savedMarketLabel(
  dataset: SearchIntelligenceDataset | undefined,
  data: SearchIntelligenceReadiness,
) {
  const market = dataset ? dataset.location_code : data.preferences.location_code;
  const language = dataset ? dataset.language_code : data.preferences.language_code;
  return `${searchMarketLabel(market)} · ${language || 'Language not set'}`;
}
