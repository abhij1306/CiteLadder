import { z } from 'zod';
import { cursorPageSchema } from './site-health.ts';
import { pageEntitySchema } from './source-pages.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Opportunities (deterministic priority catalog — backend owns the contract)
// ---------------------------------------------------------------------------

// Opportunity vocabulary (config-owned; per-subsystem severity enum — the
// site-health `issueSeveritySchema` is NOT reused, they evolve independently).
export const opportunityTypeSchema = z.enum(['visibility', 'commerce', 'site', 'traffic', 'topic']);
export const opportunitySeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const implementationStateSchema = z.enum([
  'declared',
  'observed',
  'verified',
  'contradicted',
]);
const sourceProjectionStateSchema = z.enum(['available', 'unavailable', 'not_applicable']);
export const sourceMixSchema = responseObject({
  state: sourceProjectionStateSchema,
  projection_version: z.string(),
  taxonomy_version: z.string(),
  counts: z.record(z.string(), z.number().int()),
  percentages: z.record(z.string(), z.number()),
  observation_count: z.number().int(),
  answers_with_sources: z.number().int(),
  eligible_analyzed_answers: z.number().int(),
  coverage_rate: z.number().nullable(),
  limitations: z.array(z.string()),
  audit_id: z.string().optional(),
  prompt_snapshot_ids: z.array(z.string().nullable()).optional(),
  gap_keys: z.array(z.string()).optional(),
});

/**
 * The earned half of the handoff.
 *
 * Every field is optional: an owned-pathway handoff has none of them, and the
 * backend projects a different shape for each. They were all being fetched and
 * then stripped by this schema, which is why the evidence drawer could only
 * render one sentence and a button.
 *
 * `observed_competitors` (already declared below) are the rivals found ON the
 * page. `answer_competitors` are names that merely appeared in an answer that
 * cited it. They stay separate fields here, and separate on screen, because
 * collapsing them is the defect the page-keyed detector was built to remove.
 */
const earnedHandoffFields = {
  rule_id: z.string().optional(),
  url_hash: z.string().optional(),
  page_format: z.string().optional(),
  page_format_method: z.string().nullable().optional(),
  page_title: z.string().optional(),
  snapshot_id: z.string().nullable().optional(),
  read_at: z.string().nullable().optional(),
  extracted_chars: z.number().int().optional(),
  // What to ask the publisher for, in one sentence.
  ask: z.string().optional(),
  // The tracked prompts whose answers cited the page; a declaration measures these.
  affected_prompts: z.array(z.object({ prompt_id: z.string(), text: z.string() })).optional(),
  page_entities: z.array(pageEntitySchema).optional(),
  answer_competitors: z.array(z.string()).optional(),
  observed_citation_frequency: z
    .object({
      answers_citing_page: z.number().int(),
      eligible_answers: z.number().int(),
    })
    .optional(),
  inspector_version: z.string().optional(),
  presence_version: z.string().optional(),
  page_format_version: z.string().optional(),
  handoff_template_version: z.string().optional(),
} as const;

const contentHandoffSchema = responseObject({
  ...earnedHandoffFields,
  opportunity_id: z.string(),
  pathway: z.enum(['owned', 'earned']),
  source_class: z.string().nullable(),
  canonical_domain: z.string().nullable(),
  suggested_role: z.string(),
  suggested_skill_id: z.string(),
  target_url: z.string().nullable(),
  target_theme: z.string().nullable(),
  representative_citations: z.array(z.record(z.string(), z.unknown())),
  affected_themes: z.array(z.string()),
  observed_competitors: z.array(z.string()),
  coverage: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
  truncated: z.boolean(),
  source_analysis_ids: z.array(z.string()),
  snapshot_versions: z.record(z.string(), z.unknown()),
});

// One live opportunity row in the priority-sorted catalog.
export const opportunitySchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  rule_id: z.string(),
  opportunity_type: opportunityTypeSchema,
  severity: opportunitySeveritySchema,
  priority_score: z.number(),
  title: z.string(),
  target_key: z.string(),
  target_prompt_id: uuid().nullable(),
  target_url: z.string().nullable(),
  target_theme: z.string().nullable(),
  // Backend-owned target presentation (url / frozen prompt text / humanized
  // theme / frozen product name); null when nothing user-facing exists.
  target_label: z.string().nullable(),
  // The Action this row was grouped into; it owns the workflow status.
  action_id: uuid().nullable(),
  system_rank: z.number().int(),
  display_rank: z.number().int(),
  order_source: z.enum(['system', 'manual']),
  priority_factors: z.record(z.string(), z.union([z.string(), z.number()])),
  evidence_summary: responseObject({
    count: z.number().int(),
    kinds: z.array(z.string()),
  }),
  created_at: z.string(),
  updated_at: z.string(),
});

const commandCenterMetricSchema = responseObject({
  value: z.number().nullable(),
  delta: z.number().nullable(),
});

const evidenceStateSchema = responseObject({
  state: z.enum(['observed', 'partial', 'not_run', 'unavailable']),
  observed_at: z.string().nullable(),
  freshness: z.enum(['current', 'unknown']),
  coverage: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const commandCenterSchema = responseObject({
  project: responseObject({
    id: uuid(),
    name: z.string(),
    brand_name: z.string(),
    website_url: z.string(),
  }),
  facts: responseObject({
    industry: z.string(),
    description: z.string(),
    positioning: z.string(),
    products_services: z.array(z.string()),
    target_audience: z.string(),
    competitors: z.array(
      responseObject({ id: uuid(), name: z.string(), domains: z.array(z.string()) }),
    ),
  }),
  loop: responseObject({
    connected: evidenceStateSchema,
    analyzed: evidenceStateSchema,
    acted: evidenceStateSchema,
    tracked: evidenceStateSchema,
  }),
  next_action: responseObject({
    kind: z.enum([
      'opportunity',
      'connect',
      'crawl',
      'configure_prompts',
      'audit',
      'audit_running',
      'monitor',
    ]),
    title: z.string(),
    href: z.string(),
    opportunity_id: uuid().nullable(),
  }),
  active_prompt_count: z.number().int().nonnegative(),
  track: responseObject({
    citation_share: commandCenterMetricSchema,
    engine_coverage: z.number().int(),
    observed_at: z.string().nullable(),
    limitations: z.array(z.string()),
  }),
  measurement: responseObject({
    audit_id: uuid(),
    completed_at: z.string(),
    benchmark_mode: z.string(),
    logical_engines: z.array(z.string()),
    comparable_audit_id: uuid().nullable(),
    // The persisted baseline comparison's status for the core cohort, all
    // engines (`comparable`, `no_baseline`, `matched_subset`, `baseline_pending`, ...);
    // changes are shown against `comparable_audit_id` only when `comparable`.
    comparison_status: z.string(),
    metric_snapshot_id: uuid().nullable().default(null),
    analyzer_version: z.string().nullable().default(null),
    scoring_rule_version: z.string().nullable().default(null),
  }).nullable(),
  state: responseObject({
    visibility: commandCenterMetricSchema,
    share_of_voice: commandCenterMetricSchema,
    brand_rank: commandCenterMetricSchema,
  }),
  movements: z.array(
    responseObject({
      label: z.string(),
      direction: z.string(),
      current: z.number().nullable(),
      previous: z.number().nullable(),
      delta: z.number().nullable(),
    }),
  ),
  actions: z.array(opportunitySchema),
  action_order_version: z.number().int(),
  resolved_actions: responseObject({
    since_audit_id: uuid().nullable(),
    count: z.number().int(),
    titles: z.array(z.string()),
    evidence: z
      .array(
        responseObject({
          action_id: uuid(),
          implementation_event_ids: z.array(uuid()),
          verification_event_ids: z.array(uuid()),
        }),
      )
      .default([]),
  }),
  report_available: z.boolean(),
  stale: z.boolean(),
});

export const opportunityOrderResponseSchema = responseObject({
  version: z.number().int(),
  ordered_opportunity_ids: z.array(uuid()),
});

/** The shared queue order to save, against the version the editor read; a stale version is a 409. */
export const opportunityOrderUpdateRequestSchema = z.strictObject({
  ordered_opportunity_ids: z.array(z.uuid()),
  expected_version: z.int().min(0),
});
export type OpportunityOrderUpdateRequest = z.input<typeof opportunityOrderUpdateRequestSchema>;

/**
 * The citation taxonomy: what kind of publisher a cited domain is. Descriptive,
 * never a causal claim or authority score; the order is the display order.
 */
export const sourceClassSchema = z.enum([
  'brand_owned',
  'competitor_owned',
  'review_marketplace',
  'editorial_third_party',
  'community',
  'social',
  'institutional',
  'video',
  'search_surface',
  'other_third_party',
]);
export type SourceClass = z.infer<typeof sourceClassSchema>;

/**
 * The sources a prompt gap's answers cited, classified: written into the
 * evidence of every prompt-gap Opportunity, read by its evidence view.
 * `distinct_domain_count` 0 means nothing was cited, not a measured zero.
 */
export const sourcePatternSchema = z.object({
  taxonomy_version: z.string(),
  distinct_domain_count: z.number().int(),
  independent_domain_count: z.number().int(),
  class_counts: z.partialRecord(sourceClassSchema, z.number().int()),
  observed_patterns: z.array(z.string()),
  competitor_source_domains: z.record(z.string(), z.array(z.string())),
  top_citations: z.array(
    z.object({
      domain: z.string(),
      url: z.string(),
      title: z.string(),
      source_class: sourceClassSchema,
      matched_competitor: z.string().nullable(),
    }),
  ),
  top_citations_truncated: z.boolean(),
  recommended_action: z.string(),
});
export type SourcePattern = z.infer<typeof sourcePatternSchema>;

// Full evidence bundle + provenance for one opportunity. Superseded rows stay
// readable.
export const opportunityDetailSchema = opportunitySchema.extend({
  remediation: z.string(),
  // The rule's evidence (`opportunityEvidenceSchemas`); the blocks the evidence
  // view reads are typed, the rest pass through for the Agent and exports.
  evidence: z.looseObject({ source_pattern: sourcePatternSchema.optional() }),
  source_analysis_ids: z.array(z.string()),
  source_issue_ids: z.array(z.string()),
  source_metric_ids: z.array(z.string()),
  source_traffic_ids: z.array(z.string()),
  analyzer_version: z.string(),
  rule_version: z.string(),
  formula_version: z.string(),
  content_handoff: contentHandoffSchema,
  superseded_by_id: uuid().nullable(),
  superseded_at: z.string().nullable(),
});

export const opportunitiesPageSchema = cursorPageSchema(opportunitySchema);

const siteRuleExpectedCheckSchema = responseObject({
  kind: z.literal('site_rule'),
  target_site_url_id: uuid().optional(),
  rule_id: z.string(),
  expected_outcome: z.enum(['pass', 'fail', 'partial']),
});
/**
 * Search Console clicks on the declared page or query, against a baseline
 * window frozen at declaration. Rows declared before scoping carry only
 * `expected_value` over the project total; they read as unmeasurable.
 */
const metricExpectedCheckSchema = responseObject({
  kind: z.literal('traffic_metric'),
  metric: z.string(),
  direction: z.enum(['increase', 'decrease', 'equal']),
  scope: z.enum(['page', 'query']).optional(),
  scope_key: z.string().optional(),
  min_delta: z.number().optional(),
  baseline_traffic_snapshot_id: uuid().optional(),
  baseline_value: z.number().optional(),
  baseline_window_days: z.number().int().optional(),
  expected_value: z.number().optional(),
  tolerance: z.number().optional(),
});
const visibilityExpectedCheckSchema = responseObject({
  kind: z.literal('visibility_metric'),
  metric: z.string(),
  direction: z.enum(['increase', 'decrease', 'equal']),
  min_delta: z.number(),
  tolerance: z.number(),
  target_prompt_id: uuid().nullable(),
  baseline_metric_snapshot_id: uuid().optional(),
  baseline_value: z.number().optional(),
});
/**
 * What a `search_keyword_gap` finding stores as evidence: written by the gap
 * detector, read by the declaration check and the evidence view.
 */
export const keywordGapEvidenceSchema = z.object({
  keyword: z.string().min(1),
  normalized_keyword: z.string(),
  query_key: z.string(),
  search_volume: z.number().nullable(),
  intent: z.string().nullable(),
  market: z.object({ location_code: z.number().int().nullable(), language_code: z.string() }),
  owned_origin: z.string().min(1),
  competitors: z.array(
    z.object({
      competitor_id: uuid(),
      name: z.string(),
      keyword: z.string(),
      rank_group: z.number().nullable(),
      url: z.string().nullable(),
      dataset_id: uuid(),
      row_id: uuid(),
      published_at: z.string(),
      coverage: z.string(),
    }),
  ),
  competitor_names: z.array(z.string()),
  target_resolution: z.object({
    state: z.enum(['resolved', 'ambiguous', 'no_covering_page', 'no_usable_terms']),
    candidates: z.array(z.string()),
  }),
  site_url_id: uuid().optional(),
  provider: z.literal('dataforseo'),
  statement: z.string(),
});
export type KeywordGapEvidence = z.infer<typeof keywordGapEvidenceSchema>;
/**
 * A keyword gap closes when you appear for the search: Search Console
 * impressions after go-live, or your ranking in a later Search Intelligence
 * dataset whose provider check postdates go-live. Absence is never a failure.
 */
export const keywordPresenceExpectedCheckSchema = responseObject({
  kind: z.literal('keyword_presence'),
  keyword: z.string(),
  query_key: z.string(),
  owned_origin: z.string(),
  location_code: z.number().int().nullable(),
  language_code: z.string(),
});
/**
 * An answer to one of the frozen prompts cites an owned URL, in a run after
 * go-live. `page`: the improved page's URL. `new_page`: any owned URL outside
 * the ones already cited for those prompts from `baseline_from` to go-live.
 * Frozen at declaration, so a later reclustering or rematch never changes it.
 * It says whether a URL was cited, never which version of the page was read.
 */
const ownedUrlCitedExpectedCheckSchema = responseObject({
  kind: z.literal('owned_url_cited'),
  prompt_ids: z.array(uuid()).min(1),
  // The content-angle lineage that raised the gap; null for Analyze a page.
  lineage_id: z.string().nullable(),
  expectation: z.discriminatedUnion('target', [
    responseObject({ target: z.literal('page'), url: z.string().min(1), site_url_id: uuid() }),
    responseObject({
      target: z.literal('new_page'),
      baseline_from: z.string(),
      baseline_audit_ids: z.array(uuid()),
      baseline_urls: z.array(z.string()),
    }),
  ]),
});
/**
 * One product's metric over the answers after go-live: the Products read's
 * window, limited to executions after the declaration. Met once the reading
 * clears the rule (`at_least` / `at_most` the frozen target); a window with
 * fewer than `min_samples` samples is still waiting. Frozen at declaration.
 */
export const productMetricExpectedCheckSchema = responseObject({
  kind: z.literal('product_metric'),
  product_id: uuid(),
  product_name: z.string(),
  metric: z.enum(['appearances', 'price_gap_share', 'win_rate', 'owned_merchant_answers']),
  comparison: z.enum(['at_least', 'at_most']),
  target: z.number(),
  min_samples: z.number().int(),
  window_days: z.number().int(),
  baseline_value: z.number().optional(),
});
/**
 * One Site Health rule across a frozen cohort of pages, read in the next crawl
 * comparable with `baseline_crawl_id` (same analyzer and rule catalog): met
 * when every cohort page passes, unmet with `partially_resolved` or
 * `still_failing` otherwise, unavailable (inconclusive) when that crawl could
 * not read the cohort. `page_count` counts the family's pages at declaration;
 * more than `site_url_ids` means the frozen list was cut, and then a passing
 * cohort is `cohort_sampled`, never met: the pages beyond it are unchecked.
 */
const issueFamilyExpectedCheckSchema = responseObject({
  kind: z.literal('issue_family'),
  rule_id: z.string(),
  baseline_crawl_id: uuid(),
  site_url_ids: z.array(uuid()).min(1),
  page_count: z.number().int(),
});
export const expectedCheckSchema = z.discriminatedUnion('kind', [
  issueFamilyExpectedCheckSchema,
  keywordPresenceExpectedCheckSchema,
  productMetricExpectedCheckSchema,
  ownedUrlCitedExpectedCheckSchema,
  responseObject({
    kind: z.literal('contextual_link'),
    recommendation_id: uuid(),
    internal_link_run_id: uuid(),
    target_site_url_id: uuid(),
    target_url: z.string(),
    anchor_text: z.string(),
    source_analysis_id: uuid(),
    source_artifact_id: uuid(),
    target_analysis_id: uuid(),
    target_artifact_id: uuid(),
    extractor_version: z.string(),
  }),
  siteRuleExpectedCheckSchema,
  metricExpectedCheckSchema,
  visibilityExpectedCheckSchema,
]);
export type ExpectedCheck = z.infer<typeof expectedCheckSchema>;
export type KeywordPresenceCheck = z.infer<typeof keywordPresenceExpectedCheckSchema>;

export const verificationEventSchema = responseObject({
  id: uuid(),
  observation_kind: z.enum(['observed', 'verified', 'contradicted']),
  observed_at: z.string(),
  crawl_id: uuid().nullable(),
  audit_id: uuid().nullable(),
  source_analysis_ids: z.array(uuid()),
  source_rule_evaluation_ids: z.array(uuid()),
  source_metric_ids: z.array(uuid()),
  result: z.record(z.string(), z.unknown()),
  verifier_version: z.string(),
  limitations: z.array(z.string()),
  created_at: z.string(),
});

export type CommandCenter = z.infer<typeof commandCenterSchema>;
export type OpportunityType = z.infer<typeof opportunityTypeSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;
export type OpportunitiesPage = z.infer<typeof opportunitiesPageSchema>;
