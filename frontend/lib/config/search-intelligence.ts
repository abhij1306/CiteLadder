/** Mirrors the Search Intelligence request bounds. */
import { MARKET_COUNTRIES } from '@citeladder/contracts/markets';

export const SEARCH_MAX_DEPTH = 1_000_000;
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
export const OWNED_DATASET_KINDS = [
  'footprint',
  'ranking_keywords',
  'keyword_suggestions',
  'backlink_summary',
  'referring_domains',
  'destination_pages',
  'organic_pages',
  'backlinks',
  'backlink_history',
] as const;
export const COMPETITOR_DATASET_KINDS = [
  'footprint',
  'missing_keywords',
  'shared_keywords',
  'backlink_summary',
  'backlinks',
  'referring_domains',
  'destination_pages',
  'organic_pages',
  'backlink_history',
] as const;
/** Backlink datasets need no search market. */
export const BACKLINK_DATASET_KINDS: readonly string[] = [
  'backlink_summary',
  'referring_domains',
  'destination_pages',
  'backlinks',
  'backlink_history',
];
/** One provider observation each; their depth is not a choice. */
export const FIXED_DEPTH_KINDS: readonly string[] = [
  'footprint',
  'backlink_summary',
  'backlink_history',
];
export const KEYWORD_DATASET_KINDS: readonly string[] = [
  'ranking_keywords',
  'keyword_suggestions',
  'missing_keywords',
  'shared_keywords',
];
/** Keyword comparisons: read for the owned site against one competitor's domain. */
export const COMPARISON_DATASET_KINDS: readonly string[] = ['missing_keywords', 'shared_keywords'];
/** A first analysis starts small: the owned site plus one competitor's keyword comparisons. */
export const PRESET_OWNED_KINDS: readonly string[] = ['footprint', 'ranking_keywords'];

export const SEARCH_DEFAULT_DEPTHS = {
  footprint: 1,
  ranking_keywords: 200,
  keyword_suggestions: 150,
  backlink_summary: 1,
  referring_domains: 100,
  destination_pages: 100,
  missing_keywords: 100,
  shared_keywords: 100,
  organic_pages: 100,
  backlinks: 100,
  backlink_history: 13,
} as const;

export function searchScopeLabel(scope?: string): string {
  return scope === 'domain_subdomains' ? 'Domain + subdomains' : 'Exact host';
}

// Mirrors the curated location codes in services/api/src/config/dataforseo.json.
const SEARCH_LOCATION_COUNTRIES: Record<number, string> = {
  2840: 'US',
  2826: 'GB',
  2036: 'AU',
  2124: 'CA',
  2356: 'IN',
  2554: 'NZ',
  2372: 'IE',
  2702: 'SG',
  2710: 'ZA',
  2276: 'DE',
  2250: 'FR',
  2528: 'NL',
  2784: 'AE',
};

export function searchMarketLabel(locationCode: number | null): string {
  if (locationCode === null) return 'Market not set';
  const countryCode = SEARCH_LOCATION_COUNTRIES[locationCode];
  return (
    MARKET_COUNTRIES.find(({ value }) => value === countryCode)?.label ??
    `Location code ${locationCode}`
  );
}

export const SEARCH_MARKET_OPTIONS = Object.keys(SEARCH_LOCATION_COUNTRIES).map((value) => ({
  value,
  label: searchMarketLabel(Number(value)),
}));
