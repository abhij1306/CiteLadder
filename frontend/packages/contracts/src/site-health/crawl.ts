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
/** A crawl that still runs: its tasks may claim, write and settle. */
export const ACTIVE_CRAWL_STATUSES = [
  'queued',
  'running',
] as const satisfies readonly CrawlStatus[];
/** A crawl that has ended; its counters and snapshot are persisted. */
export const TERMINAL_CRAWL_STATUSES = [
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
] as const satisfies readonly CrawlStatus[];
/** An ended crawl whose analyses are readable results (a cancelled one keeps what it analyzed). */
export const USABLE_CRAWL_STATUSES = [
  'completed',
  'partially_completed',
  'cancelled',
] as const satisfies readonly CrawlStatus[];
// Membership tests over a stored status: persisted rows hold plain text.
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
// How a discovered URL was first observed (immutable provenance).
export const siteUrlSourceSchema = z.enum(['root', 'link', 'sitemap', 'redirect']);

// Per-URL analysis presentation state. `error`/`blocked` are explicit states
// (never a fabricated zero score); `not_measured` is terminal, while
// `not_selected` covers URLs outside the monitored set.
export const pageAnalysisStatusSchema = z.enum([
  'not_selected',
  'not_measured',
  'pending',
  'running',
  'completed',
  'partially_completed',
  'failed',
  // Presentation-only terminal states. `blocked` = the latest analyze task
  // ended under a config-owned policy denial (robots/SSRF); `error` = any other
  // terminal-unsuccessful analysis. `failed` stays an internal persistence
  // state (the API never surfaces it as page copy).
  'error',
  'blocked',
  'cancelled',
]);

// Page-type classification vocabulary (site-health v2 P1). The deterministic
// backend classifier stamps every page analysis with one of these types; the
// page/inventory/detail DTOs project it as `page_kind`.
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

// Classification completeness is independent of crawl and AEO evidence
// coverage. `other` is a terminal classifier abstention and does not enter the
// classification coverage numerator. It can still enter the scored cohort
// when independently applicable Web or AEO checks produce a score. The
// persisted projection keeps its source analysis, artifact and task ids; the
// browser response does not carry them (owner, 2 Nov 2026).
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

// One `score_summary.by_page_kind` bucket (site-health v2 P1): the analyzed
// count + pooled Web Fundamentals and AEO measurement projections for one
// page type. A mean is null when no analyzed page of the type produced that
// score — never a fabricated zero.
export const pageKindScoreSummarySchema = responseObject({
  analyzed_count: z.number().int(),
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_measurement_reason: z.string(),
});

// Crawl score/coverage summary (nullable scores until analysis produces them).
// `by_page_kind` breaks the means down per classified page type (empty until
// at least one analyzed page has been classified).
export const siteScoreSummarySchema = responseObject({
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
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

// A crawl projection. `total_url_count` is null while full discovery runs and
// ALWAYS null for a Free sample crawl; `has_more_site_urls`/`discovered_count`
// are absent (optional) or null under Free redaction — never a leaked total.
/**
 * How a crawl of the project's own site treats robots.txt exclusions. `ignore`
 * waives only the disallow rules; crawl delay, an unreadable or access-blocked
 * robots.txt, rate limits and suppression still apply.
 */
export const crawlRobotsHandlingSchema = z.enum(['respect', 'ignore']);
export type CrawlRobotsHandling = z.infer<typeof crawlRobotsHandlingSchema>;

/** The crawl's robots choice and, when it ignores robots.txt, who confirmed authorization. */
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
  // Why a `partially_completed` crawl is partial. Empty on every other status.
  // URLs that could not be FETCHED are routine on a real site and are not an
  // analysis failure, so the two can never share one message.
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
  // Redactable count fields (Free → null / absent, never a number).
  discovered_count: z.number().int().nullable().optional(),
  total_url_count: z.number().int().nullable(),
  has_more_site_urls: z.boolean().nullable().optional(),
  score_summary: siteScoreSummarySchema.nullable(),
  // REQUIRED key (the backend response model always serializes it); null
  // on healthy/partial crawls and on list projections.
  failure_summary: crawlFailureSummarySchema.nullable(),
  // v2 P2: bounded site-level facts (robots AI-crawler stance, llms.txt,
  // sitemap files). Mirrors the backend's untyped `dict | None`, and is
  // REQUIRED because the response model always serializes the key — making
  // it optional would weaken the drift contract.
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

/** How often a scheduled crawl runs. */
export const crawlScheduleCadenceSchema = z.enum(['weekly', 'monthly']);
/**
 * What the last scheduled occurrence did: started a crawl, or skipped because
 * a crawl was already queued or running, or the page-fetch budget refused it.
 */
export const crawlScheduleOutcomeSchema = z.enum([
  'created',
  'crawl_already_active',
  'site_health_fetches_exhausted',
  'failed',
]);
// `GET|PUT /projects/{id}/crawl-schedule` — a project without one reads as off.
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
