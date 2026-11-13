/**
 * Search Intelligence screen config. Request bounds, default depths and the
 * offered markets come from the API with readiness, never restated here.
 */
import { MARKET_COUNTRIES } from '@citeladder/contracts/markets';
import type {
  SearchDatasetKind,
  searchReadinessSchema,
} from '@citeladder/contracts/search-intelligence';
import type { z } from 'zod';

export type SearchColumn = {
  field: string;
  label: string;
  numeric?: boolean;
  detail?: boolean;
  precision?: number;
};
/** Columns per row kind; the footprint's columns are the fallback for an unknown kind. */
export const SEARCH_COLUMNS_BY_KIND: {
  footprint: SearchColumn[];
  [kind: string]: SearchColumn[];
} = {
  footprint: [
    { field: 'keyword', label: 'Keyword' },
    { field: 'search_volume', label: 'Volume', numeric: true },
    { field: 'difficulty', label: 'Difficulty', numeric: true },
    { field: 'intent', label: 'Intent' },
    { field: 'dataforseo_rank', label: 'DataForSEO rank', numeric: true },
  ],
  ranking_keywords: [
    { field: 'keyword', label: 'Keyword' },
    { field: 'rank_group', label: 'Position', numeric: true },
    { field: 'search_volume', label: 'Volume', numeric: true },
    { field: 'url', label: 'Ranking page' },
    { field: 'etv', label: 'Est. traffic', numeric: true },
    { field: 'cpc', label: 'CPC (USD)', numeric: true, precision: 2 },
    { field: 'difficulty', label: 'Difficulty', numeric: true },
    { field: 'intent', label: 'Intent' },
  ],
  keyword_suggestions: [
    { field: 'keyword', label: 'Keyword' },
    { field: 'search_volume', label: 'Volume', numeric: true },
    { field: 'difficulty', label: 'Difficulty', numeric: true },
    { field: 'intent', label: 'Intent' },
  ],
  missing_keywords: [
    { field: 'keyword', label: 'Missing keyword' },
    { field: 'owned_rank_group', label: 'Owned rank', numeric: true },
    { field: 'rank_group', label: 'Competitor rank', numeric: true },
    { field: 'search_volume', label: 'Volume', numeric: true },
    { field: 'difficulty', label: 'Difficulty', numeric: true },
  ],
  shared_keywords: [
    { field: 'keyword', label: 'Shared keyword' },
    { field: 'owned_rank_group', label: 'Owned rank', numeric: true },
    { field: 'rank_group', label: 'Competitor rank', numeric: true },
    { field: 'search_volume', label: 'Volume', numeric: true },
  ],
  referring_domains: [
    { field: 'domain', label: 'Referring domain' },
    { field: 'backlinks', label: 'Backlinks', numeric: true },
    { field: 'dataforseo_rank', label: 'DataForSEO rank', numeric: true },
  ],
  destination_pages: [
    { field: 'url', label: 'Destination page' },
    { field: 'backlinks', label: 'Backlinks', numeric: true },
    { field: 'referring_domains', label: 'Referring domains', numeric: true },
    { field: 'referring_main_domains', label: 'Referring root domains', numeric: true },
    { field: 'dataforseo_rank', label: 'DataForSEO rank', numeric: true },
  ],
  citation_matches: [
    { field: 'domain', label: 'Cited domain' },
    { field: 'url', label: 'Cited URL' },
  ],
  organic_pages: [
    { field: 'url', label: 'Organic page' },
    { field: 'organic_keywords', label: 'Organic keywords', numeric: true },
    { field: 'etv', label: 'Est. traffic', numeric: true },
  ],
  backlinks: [
    { field: 'url_from', label: 'Source URL', detail: true },
    { field: 'url', label: 'Destination' },
    { field: 'anchor', label: 'Anchor', detail: true },
    { field: 'dofollow', label: 'Follow', detail: true },
    { field: 'dataforseo_rank', label: 'Link rank (0–100)', numeric: true },
    { field: 'backlinks_spam_score', label: 'Spam', numeric: true },
  ],
};

/** The one browser vocabulary of dataset kinds; the server owns their semantics. */
export const SEARCH_DATASET_LABELS: Readonly<Record<string, string>> = {
  footprint: 'Keyword footprint',
  ranking_keywords: 'Ranked keywords',
  keyword_suggestions: 'Keyword suggestions',
  backlink_summary: 'Backlink summary',
  referring_domains: 'Referring domains',
  destination_pages: 'Destination pages',
  missing_keywords: 'Keywords they rank for and you don’t',
  shared_keywords: 'Keywords you both rank for',
  organic_pages: 'Organic top pages',
  backlinks: 'Individual backlinks',
  backlink_history: 'Backlink history (past year)',
  citation_matches: 'Citation matches',
};
/** A first analysis starts small: the owned site plus one competitor's keyword comparisons. */
export const PRESET_OWNED_KINDS: readonly SearchDatasetKind[] = ['footprint', 'ranking_keywords'];

export function searchScopeLabel(scope?: string): string {
  return scope === 'domain_subdomains' ? 'Domain + subdomains' : 'Exact host';
}

/** The markets the server offers (readiness `markets`): country and location code. */
type SearchMarkets = z.infer<typeof searchReadinessSchema>['markets'];

/** A location code's country name, from the markets the server sent. */
export function searchMarketLabel(locationCode: number | null, markets: SearchMarkets): string {
  if (locationCode === null) return 'Market not set';
  const countryCode = markets.find((market) => market.location_code === locationCode)?.country_code;
  return (
    MARKET_COUNTRIES.find(({ value }) => value === countryCode)?.label ??
    `Location code ${locationCode}`
  );
}

/** The market picker's options: each offered market by name, keyed by location code. */
export function searchMarketOptions(markets: SearchMarkets) {
  return markets.map(({ location_code }) => ({
    value: String(location_code),
    label: searchMarketLabel(location_code, markets),
  }));
}
