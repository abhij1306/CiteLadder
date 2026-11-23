import { z } from 'zod';

import { responseObject, uuid } from './core.ts';

// Independent crawl lifecycle sub-states.
export const crawlOverallStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
]);
type CrawlStatus = z.infer<typeof crawlOverallStatusSchema>;
export const ACTIVE_CRAWL_STATUSES = [
  'queued',
  'running',
] as const satisfies readonly CrawlStatus[];
export const TERMINAL_CRAWL_STATUSES = [
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
] as const satisfies readonly CrawlStatus[];
export const USABLE_CRAWL_STATUSES = [
  'completed',
  'partially_completed',
  'cancelled',
] as const satisfies readonly CrawlStatus[];
const ACTIVE: readonly string[] = ACTIVE_CRAWL_STATUSES;
const TERMINAL: readonly string[] = TERMINAL_CRAWL_STATUSES;
const USABLE: readonly string[] = USABLE_CRAWL_STATUSES;
export const isActiveCrawl = (status: string) => ACTIVE.includes(status);
export const isTerminalCrawl = (status: string) => TERMINAL.includes(status);
export const isUsableCrawl = (status: string) => USABLE.includes(status);
export const crawlDiscoveryStatusSchema = z.enum([
  'pending',
  'running',
  'stopped',
  'completed',
  'sample_completed',
  'failed',
  'cancelled',
]);
export const crawlAnalysisStatusSchema = z.enum([
  'pending',
  'running',
  'stopped',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
]);
export const siteUrlSourceSchema = z.enum(['root', 'link', 'sitemap', 'redirect']);

export const pageAnalysisStatusSchema = z.enum([
  'not_selected',
  'not_measured',
  'pending',
  'running',
  'completed',
  'partially_completed',
  'failed',
  'error',
  'blocked',
  'cancelled',
]);

export const pageKindSchema = z.enum([
  'homepage',
  'article',
  'editorial_index',
  'product',
  'category',
  'pricing',
  'docs',
  'faq',
  'about_contact',
  'service',
  'local',
  'guide',
  'how_to',
  'listicle',
  'comparison',
  'alternative',
  'case_study_review',
  'trust_policy',
  'other',
]);

const classificationStateSchema = z.enum(['complete', 'partial', 'not_measured']);
export const classificationProjectionFields = {
  classified_page_count: z.number().int().nonnegative(),
  other_page_count: z.number().int().nonnegative(),
  classification_error_page_count: z.number().int().nonnegative(),
  classification_expected_page_count: z.number().int().nonnegative(),
  classification_coverage: z.number().min(0).max(1).nullable(),
  classification_state: classificationStateSchema,
  classification_reason_groups: z.record(z.string(), z.number().int().nonnegative()),
  classification_formula_version: z.string(),
  scored_page_kind_set: z.array(pageKindSchema),
  scored_page_count_by_kind: z.partialRecord(pageKindSchema, z.number().int().nonnegative()),
} as const;

export const checksRunSchema = responseObject({
  run: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const pageKindScoreSummarySchema = responseObject({
  analyzed_count: z.number().int(),
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_measurement_reason: z.string(),
  web_fundamentals_checks: checksRunSchema.nullable(),
  aeo_readiness_checks: checksRunSchema.nullable(),
});

export const siteScoreSummarySchema = responseObject({
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  web_fundamentals_checks: checksRunSchema.nullable(),
  aeo_readiness_checks: checksRunSchema.nullable(),
  search_eligibility: z.enum(['eligible', 'blocked', 'unknown', 'excluded']),
  ...classificationProjectionFields,
  selected_count: z.number().int(),
  analyzed_count: z.number().int(),
  issue_count: z.number().int(),
  scoring_version: z.string(),
  by_page_kind: z.record(z.string(), pageKindScoreSummarySchema),
});

export const crawlCountersSchema = responseObject({
  discovered: z.number().int().nullable(),
  selected: z.number().int(),
  queued: z.number().int(),
  running: z.number().int(),
  analyzed: z.number().int(),
  errors: z.number().int(),
  blocked: z.number().int(),
  failure_breakdown: responseObject({
    robots_denied: z.number().int(),
    http_4xx: z.number().int(),
    http_5xx: z.number().int(),
    timeout: z.number().int(),
  }),
  activity: responseObject({
    state: z.enum(['working', 'waiting', 'stalled', 'terminal']),
    reason: z.enum(['active_work', 'host_gate', 'retry_backoff', 'expired_lease', 'terminal']),
    queue_depth: z.number().int(),
    next_available_at: z.string().nullable(),
  }),
  by_page_kind: z.record(z.string(), z.number().int()),
});

// Why a crawl failed: stable machine `code` + human
// `message` + the terminal HTTP status / attempt count when present. Projected
// from the root discover task's terminal fetch attempts; null on any crawl
// that did not fail (and on list projections — N+1 avoidance).
const crawlFailureSummarySchema = responseObject({
  code: z.string(),
  message: z.string(),
  attempts: z.number().int().nullable(),
  status_code: z.number().int().nullable(),
  target_url: z.string(),
});

export const crawlRobotsHandlingSchema = z.enum(['respect', 'ignore']);
export type CrawlRobotsHandling = z.infer<typeof crawlRobotsHandlingSchema>;

export const crawlRobotsChoiceSchema = responseObject({
  handling: crawlRobotsHandlingSchema,
  decided_by_email: z.string().nullable(),
  decided_at: z.string().nullable(),
});
export type CrawlRobotsChoice = z.infer<typeof crawlRobotsChoiceSchema>;

export const siteCrawlSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  project_id: uuid(),
  profile_id: uuid(),
  status: crawlOverallStatusSchema,
  discovery_status: crawlDiscoveryStatusSchema,
  analysis_status: crawlAnalysisStatusSchema,
  root_url: z.string(),
  sample_mode: z.boolean(),
  robots: crawlRobotsChoiceSchema,
  inventory_complete: z.boolean(),
  partial_reason: z.enum([
    '',
    'discovery_incomplete',
    'analysis_incomplete',
    'discovery_and_analysis_incomplete',
  ]),
  visible_url_count: z.number().int(),
  analyzed_count: z.number().int(),
  failed_count: z.number().int(),
  discovery_requested_count: z.number().int(),
  analysis_requested_count: z.number().int(),
  counters: crawlCountersSchema,
  discovered_count: z.number().int().nullable().optional(),
  total_url_count: z.number().int().nullable(),
  has_more_site_urls: z.boolean().nullable().optional(),
  score_summary: siteScoreSummarySchema.nullable(),
  // REQUIRED key (the backend response model always serializes it); null
  // on healthy/partial crawls and on list projections.
  failure_summary: crawlFailureSummarySchema.nullable(),
  site_facts: z.record(z.string(), z.unknown()).nullable(),
  extractor_version: z.string(),
  analyzer_version: z.string(),
  rule_version: z.string(),
  scoring_version: z.string(),
  error_message: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const crawlScheduleCadenceSchema = z.enum(['weekly', 'monthly']);
export const crawlScheduleOutcomeSchema = z.enum([
  'created',
  'crawl_already_active',
  'site_health_fetches_exhausted',
  'failed',
]);
export const crawlScheduleSchema = responseObject({
  project_id: uuid(),
  enabled: z.boolean(),
  cadence: crawlScheduleCadenceSchema,
  next_run_at: z.string().nullable(),
  last_run_at: z.string().nullable(),
  last_outcome: crawlScheduleOutcomeSchema.nullable(),
  last_crawl_id: uuid().nullable(),
});

export type CrawlScheduleCadence = z.infer<typeof crawlScheduleCadenceSchema>;
export type CrawlSchedule = z.infer<typeof crawlScheduleSchema>;
export type CrawlOverallStatus = z.infer<typeof crawlOverallStatusSchema>;
export type CrawlDiscoveryStatus = z.infer<typeof crawlDiscoveryStatusSchema>;
export type CrawlAnalysisStatus = z.infer<typeof crawlAnalysisStatusSchema>;
export type PageAnalysisStatus = z.infer<typeof pageAnalysisStatusSchema>;
export type PageKind = z.infer<typeof pageKindSchema>;
export type PageKindScoreSummary = z.infer<typeof pageKindScoreSummarySchema>;
export type SiteScoreSummary = z.infer<typeof siteScoreSummarySchema>;
export type SiteCrawl = z.infer<typeof siteCrawlSchema>;
