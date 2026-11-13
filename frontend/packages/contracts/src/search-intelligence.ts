import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);

export const searchTargetSchema = responseObject({
  identity: z.string(),
  label: z.string(),
  registrable_domain: z.string(),
  hostname: z.string(),
  origin: z.string(),
  source_kind: z.string(),
});
export const researchScopeSchema = z.enum(['exact_host', 'domain_subdomains']);

/** The datasets a Search Intelligence review can buy. */
export const searchDatasetKindSchema = z.enum([
  'footprint',
  'ranking_keywords',
  'keyword_suggestions',
  'missing_keywords',
  'shared_keywords',
  'backlink_summary',
  'referring_domains',
  'destination_pages',
  'organic_pages',
  'backlinks',
  'backlink_history',
]);
export type SearchDatasetKind = z.infer<typeof searchDatasetKindSchema>;

type SearchDatasetTraits = Readonly<{
  /** Read for the owned site. */
  owned: boolean;
  /** Read for a competitor's domain. */
  competitor: boolean;
  /** Read for the owned site against one competitor; requires that competitor. */
  comparison: boolean;
  /** Rows are keywords; accepts the keyword ordering and volume controls. */
  keyword: boolean;
  /** A backlink dataset; it needs no search market. */
  backlink: boolean;
  /** One provider observation; its depth is not a choice and it is always whole. */
  fixedDepth: boolean;
  /** A single summary row; a provider row total does not apply. */
  summary: boolean;
  /** Requires a seed phrase; every other kind rejects one. */
  seed: boolean;
}>;

const traits = (set: Partial<SearchDatasetTraits>): SearchDatasetTraits => ({
  owned: false,
  competitor: false,
  comparison: false,
  keyword: false,
  backlink: false,
  fixedDepth: false,
  summary: false,
  seed: false,
  ...set,
});
const ownedAndCompetitor = { owned: true, competitor: true } as const;

/** What each dataset kind accepts and how it is read: the one table both sides derive from. */
export const SEARCH_DATASET_KINDS: Readonly<Record<SearchDatasetKind, SearchDatasetTraits>> = {
  footprint: traits({ ...ownedAndCompetitor, fixedDepth: true, summary: true }),
  ranking_keywords: traits({ owned: true, keyword: true }),
  keyword_suggestions: traits({ owned: true, keyword: true, seed: true }),
  missing_keywords: traits({ competitor: true, comparison: true, keyword: true }),
  shared_keywords: traits({ competitor: true, comparison: true, keyword: true }),
  backlink_summary: traits({
    ...ownedAndCompetitor,
    backlink: true,
    fixedDepth: true,
    summary: true,
  }),
  referring_domains: traits({ ...ownedAndCompetitor, backlink: true }),
  destination_pages: traits({ ...ownedAndCompetitor, backlink: true }),
  organic_pages: traits(ownedAndCompetitor),
  backlinks: traits({ ...ownedAndCompetitor, backlink: true }),
  backlink_history: traits({ ...ownedAndCompetitor, backlink: true, fixedDepth: true }),
};

/** The dataset kinds with one trait, in table order. */
export const searchDatasetKindsWith = (trait: keyof SearchDatasetTraits): SearchDatasetKind[] =>
  searchDatasetKindSchema.options.filter((kind) => SEARCH_DATASET_KINDS[kind][trait]);

/** The traits of a stored kind; `undefined` for a kind outside the table, such as a derived dataset. */
export const searchDatasetTraits = (kind: string): SearchDatasetTraits | undefined => {
  const parsed = searchDatasetKindSchema.safeParse(kind);
  return parsed.success ? SEARCH_DATASET_KINDS[parsed.data] : undefined;
};
/**
 * An analysis run's lifecycle: reviewed (priced, awaiting confirmation), then
 * queued and running while its requests are sent, then one of the finished
 * outcomes. `uncertain` means a request may have been charged without its
 * result arriving.
 */
export const searchRunStatusSchema = z.enum([
  'reviewed',
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'uncertain',
  'cancelled',
]);
export type SearchRunStatus = z.infer<typeof searchRunStatusSchema>;
export const searchPreferencesSchema = responseObject({
  research_scope: researchScopeSchema.optional(),
  owned_target_id: z.string().nullable(),
  competitor_ids: z.array(z.uuid()),
  location_code: z.number().int().nullable(),
  language_code: z.string(),
  reuse_recent: z.boolean(),
  depths: z.record(z.string(), z.number().int()),
});
export const searchRunSchema = responseObject({
  id: z.uuid(),
  status: searchRunStatusSchema,
  action: z.string(),
  pricing_version: z.string(),
  estimated_cost_usd: z.string().nullable(),
  provider_reported_cost_usd: z.string().nullable(),
  planned_calls: z.number().int(),
  completed_calls: z.number().int(),
  planned_rows: z.number().int(),
  received_rows: z.number().int(),
  uncertain_calls: z.number().int(),
  error_code: z.string(),
  error_detail: z.string(),
  expires_at: z.string(),
  confirmed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  frozen_scope: z.record(z.string(), z.unknown()),
  call_plan: z.array(z.record(z.string(), z.unknown())),
  reused_datasets: z.array(z.record(z.string(), z.unknown())),
  created_at: z.string(),
});
export const searchDatasetSchema = responseObject({
  research_scope: researchScopeSchema,
  id: z.uuid(),
  run_id: z.uuid(),
  dataset_kind: z.string(),
  target_domain: z.string(),
  target_hostname: z.string(),
  target_origin: z.string(),
  acquisition: z.record(z.string(), z.unknown()),
  comparison_origin: z.string(),
  location_code: z.number().int().nullable(),
  language_code: z.string(),
  status: z.string(),
  coverage: z.string(),
  requested_rows: z.number().int(),
  raw_rows_received: z.number().int(),
  unique_rows_saved: z.number().int(),
  provider_total: z.number().int().nullable(),
  truncated: z.boolean(),
  summary: z.record(z.string(), z.unknown()),
  collection_started_at: z.string().nullable(),
  collection_ended_at: z.string().nullable(),
  published_at: z.string().nullable(),
  filtered_saved_count: z.number().int().nullable().optional(),
}).catchall(z.unknown());
export const searchReadinessSchema = responseObject({
  connected: z.boolean(),
  connection_id: z.uuid().nullable(),
  owned_targets: z.array(searchTargetSchema),
  competitors: z.array(searchTargetSchema),
  preferences: searchPreferencesSchema,
  latest_run: searchRunSchema.nullable(),
  datasets: z.array(searchDatasetSchema),
  /** The markets a review may choose: each country and its DataForSEO location code. */
  markets: z.array(responseObject({ country_code: z.string(), location_code: z.number().int() })),
  /** The largest depth a list dataset accepts. */
  max_depth: z.number().int(),
});
export const searchRowSchema = responseObject({
  id: z.uuid(),
  dataset_id: z.uuid(),
  call_id: z.uuid().nullable(),
  row_kind: z.string(),
  keyword: z.string(),
  domain: z.string(),
  url: z.string(),
  search_volume: z.number().int().nullable(),
  difficulty: z.number().int().nullable(),
  intent: z.string(),
  rank_group: z.number().int().nullable(),
  owned_rank_group: z.number().int().nullable(),
  etv: z.string().nullable(),
  backlinks: z.number().int().nullable(),
  referring_main_domains: z.number().int().nullable(),
  dataforseo_rank: z.number().int().nullable(),
  auxiliary: z.record(z.string(), z.unknown()),
  // The Action a missing-keyword row became, when it passed the keyword-gap gates.
  action_id: z.uuid().nullable().optional(),
}).catchall(z.unknown());
export const searchDatasetPageSchema = responseObject({
  dataset: searchDatasetSchema,
  rows: z.array(searchRowSchema),
  next_cursor: z.string().nullable(),
});
