/**
 * What each Opportunity rule stores as `evidence`: written by its producer in
 * the refresh, read by declaration checks and evidence views. One schema per
 * rule family; `opportunityEvidenceSchemas` names the schema of every rule.
 */
import { z } from 'zod';
import { keywordGapEvidenceSchema } from './opportunities.ts';
import { internalLinkSchema } from './site-health/internal-links.ts';

const json = z.record(z.string(), z.unknown());

/** A tracked prompt whose answers omit the brand or never cite an owned page. */
const promptGapEvidenceSchema = z.object({
  prompt_text: z.string(),
  prompt_intent: z.string(),
  buyer_stage: z.string(),
  new_prompt_intent: z.string(),
  prompt_theme: z.string(),
  prompt_index: z.number().int(),
  repetitions: z.number().int(),
  observed_engines: z.array(z.string()),
  brand_mentioned: z.boolean(),
  owned_citation_count: z.number(),
  source_pattern: json,
  competitor_names: z.array(z.string()).optional(),
  engines: z.array(z.string()).optional(),
  owned_domains: z.array(z.string()).optional(),
  audit_id: z.string(),
  priority_factors: z.object({
    value_factor: z.number(),
    value_source: z.string(),
    value_key: z.string(),
    recommendation_strength_factor: z.number(),
  }),
});

/** A prompt decline the audit confirmed across runs and engines. */
const promptDeclineEvidenceSchema = z.object({
  prompt: z.string(),
  rolling_four: z.unknown(),
  immediate_delta: z.number().nullable(),
  engines: z.array(z.string()),
  engine_agreement: z.number(),
  repetition_agreement: z.number(),
  trend_confidence: z.number(),
  components: z.unknown(),
  content_goal: z.string(),
});

/** A cited third-party page competitors are listed on and the brand is not. */
const earnedListingEvidenceSchema = z.object({
  content_handoff: z.looseObject({
    url_hash: z.string(),
    affected_prompts: z.array(z.object({ prompt_id: z.string(), text: z.string() })),
  }),
  priority_factors: z.object({
    page_recurrence_factor: z.number(),
    page_competitor_presence_factor: z.number(),
  }),
});

/** A Site Health defect on one owned page. */
const siteIssueEvidenceSchema = z.object({
  issue_rule_id: z.string(),
  issue_severity: z.string(),
  category: z.string(),
  issue_evidence: json,
  crawl_id: z.string(),
  site_url_id: z.string(),
  url: z.string(),
  coverage: json,
  limitations: z.array(z.string()),
});

/** Suggested contextual links from one owned page, from one link run. */
const contextualLinksEvidenceSchema = z.object({
  site_url_id: z.string(),
  crawl_id: z.string(),
  internal_link_run_id: z.string(),
  recommendations: z.array(internalLinkSchema),
  content_handoff: z.object({
    source_url: z.string(),
    recommendations: z.array(internalLinkSchema),
  }),
});

/** One field of an owned page that changed between two crawls. */
const siteChangeEvidenceSchema = z.object({
  change_snapshot_id: z.string(),
  change_observation_id: z.string(),
  crawl_a_id: z.string().nullable(),
  crawl_b_id: z.string(),
  field: z.string(),
  before_value: z.unknown(),
  after_value: z.unknown(),
  change_class: z.string(),
  complete_pair: z.boolean(),
  coverage: json,
});

/** A promoted Search Console signal on a page or query. */
const demandSignalEvidenceSchema = z.object({
  demand_snapshot_id: z.string(),
  demand_signal_id: z.string(),
  signal_type: z.string(),
  metrics: json,
  coverage: json,
  limitations: z.array(z.unknown()),
  query_relevance: z.unknown(),
});

const productNotMentionedEvidenceSchema = z.object({
  product_id: z.string(),
  product_visibility: z.number(),
  audit_id: z.string(),
});

const catalogFieldsEvidenceSchema = z.object({
  product_id: z.string(),
  product_name: z.unknown(),
  missing_fields: z.array(z.string()),
});

const citedAlternativesEvidenceSchema = z.object({
  category_id: z.string(),
  third_party_citation_count: z.number().int(),
  product_visibility: z.number(),
  audit_id: z.string(),
});

const promptGap = promptGapEvidenceSchema;
const siteIssue = siteIssueEvidenceSchema;
const siteChange = siteChangeEvidenceSchema;
const demand = demandSignalEvidenceSchema;

/** Every rule's evidence schema, by rule id. */
export const opportunityEvidenceSchemas = {
  brand_absent_high_value_prompt: promptGap,
  owned_page_not_cited: promptGap,
  confirmed_prompt_decline: promptDeclineEvidenceSchema,
  earned_page_acquire_listing: earnedListingEvidenceSchema,
  missing_structured_data: siteIssue,
  schema_properties_incomplete: siteIssue,
  schema_visible_content_conflict: siteIssue,
  content_structure_incomplete: siteIssue,
  citability_trust_incomplete: siteIssue,
  site_contextual_links: contextualLinksEvidenceSchema,
  site_link_near_orphan: siteIssue,
  site_link_weak_authority: siteIssue,
  site_change_potential_regression: siteChange,
  site_change_critical_regression: siteChange,
  site_change_metadata_inconsistency: siteChange,
  site_change_cosmetic_refresh: siteChange,
  search_demand_content_gap: demand,
  striking_distance_query: demand,
  query_cannibalization: demand,
  property_relative_ctr_gap: demand,
  emerging_query: demand,
  declining_query: demand,
  high_traffic_low_visibility: demand,
  low_share_of_voice_theme: json,
  search_keyword_gap: keywordGapEvidenceSchema,
  product_not_mentioned: productNotMentionedEvidenceSchema,
  catalog_fields_missing: catalogFieldsEvidenceSchema,
  cited_alternatives_without_uploaded_presence: citedAlternativesEvidenceSchema,
} as const;

export type OpportunityEvidence = z.input<
  (typeof opportunityEvidenceSchemas)[keyof typeof opportunityEvidenceSchemas]
>;
