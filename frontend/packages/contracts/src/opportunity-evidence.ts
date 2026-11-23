import { z } from 'zod';
import { keywordGapEvidenceSchema, sourcePatternSchema } from './opportunities.ts';
import { internalLinkSchema } from './site-health/internal-links.ts';

const json = z.record(z.string(), z.unknown());

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
  source_pattern: sourcePatternSchema,
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

export const siteIssueEvidenceSchema = z.object({
  issues: z
    .array(
      z.object({
        issue_id: z.string(),
        rule_id: z.string(),
        severity: z.string(),
        category: z.string(),
        evidence: json,
      }),
    )
    .min(1),
  crawl_id: z.string(),
  site_url_id: z.string(),
  url: z.string(),
  coverage: json,
  limitations: z.array(z.string()),
});

export const issueFamilyCohortSchema = z.object({
  rule_id: z.string(),
  rule_label: z.string(),
  crawl_id: z.string(),
  group_id: z.string(),
  page_count: z.number().int(),
  whole_site: z.boolean(),
  pages: z.array(z.object({ site_url_id: z.string(), url: z.string() })),
});
export type IssueFamilyCohort = z.infer<typeof issueFamilyCohortSchema>;

export const siteIssueFamilyEvidenceSchema = z.object({
  issue_rule_id: z.string(),
  issue_severity: z.string(),
  category: z.string(),
  cohort: issueFamilyCohortSchema,
  coverage: json,
  limitations: z.array(z.string()),
});

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

const relevanceCoverage = z.number().optional().catch(undefined);
const absentTerms = z.array(z.string()).optional().catch(undefined);

export const queryRelevanceSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('measured'),
    title_coverage: relevanceCoverage,
    h1_coverage: relevanceCoverage,
    primary_content_coverage: relevanceCoverage,
    absent_from_title: absentTerms,
    absent_from_h1: absentTerms,
    statement: z.string().nullable().optional().catch(null),
  }),
  z.object({ state: z.literal('unknown'), reason: z.string() }),
]);

const demandSignalEvidenceSchema = z.object({
  demand_snapshot_id: z.string(),
  demand_signal_id: z.string(),
  signal_type: z.string(),
  metrics: json,
  coverage: json,
  limitations: z.array(z.unknown()),
  query_relevance: queryRelevanceSchema.nullable(),
});

const productMetricEvidenceSchema = z.object({
  product_id: z.string(),
  product_name: z.string(),
  window_days: z.number().int(),
  as_of: z.string(),
  executions: z.number().int(),
  metric: z.string(),
  value: z.number(),
  samples: z.number().int(),
  threshold: z.number(),
  appearances: z.number().int(),
  ordered_appearances: z.number().int(),
  win_rate: z.number().nullable(),
  mentioned_price: z
    .object({ median: z.number().nullable(), currency: z.string(), quoted: z.number().int() })
    .nullable(),
  catalog_price: z.object({ amount: z.number(), currency: z.string() }).nullable(),
  merchants: z.array(z.object({ domain: z.string(), count: z.number().int() })),
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

export const CONTENT_GAP_EVIDENCE_MEMBERS = 20;

const contentGapEvidenceSchema = z.object({
  run_id: z.string(),
  lineage_id: z.string(),
  angle_label: z.string(),
  topic_id: z.string().nullable(),
  prompts: z.array(z.object({ id: z.string(), text: z.string().nullable() })),
  engines: z.array(z.string()),
  citation_count: z.number().int(),
  domain_count: z.number().int(),
  competitor_count: z.number().int(),
  member_count: z.number().int(),
  members: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        domain: z.string(),
        classification: z.string(),
        matched_competitor: z.string().nullable(),
        citation_count: z.number().int(),
      }),
    )
    .max(CONTENT_GAP_EVIDENCE_MEMBERS),
  window: z.object({ start: z.string(), end: z.string() }),
  methodology_version: z.string(),
  formula_version: z.string(),
  limitations: z.array(json),
});

const contentGapImprovePageEvidenceSchema = contentGapEvidenceSchema.extend({
  site_url_id: z.string(),
  url: z.string(),
  match_method: z.literal('model_pick'),
  continues_action_id: z.string().optional(),
});
export type ContentGapImprovePageEvidence = z.infer<typeof contentGapImprovePageEvidenceSchema>;

const contentGapNewPageEvidenceSchema = contentGapEvidenceSchema.extend({
  planned_page_key: z.string(),
});
export type ContentGapNewPageEvidence = z.infer<typeof contentGapNewPageEvidenceSchema>;

export const contentGapFindingEvidenceSchema = z.union([
  contentGapImprovePageEvidenceSchema,
  contentGapNewPageEvidenceSchema,
]);
export type ContentGapEvidence = z.infer<typeof contentGapFindingEvidenceSchema>;

export type ContentGapFinding =
  | { rule_id: 'content_gap_improve_page'; evidence: ContentGapImprovePageEvidence }
  | { rule_id: 'content_gap_new_page'; evidence: ContentGapNewPageEvidence };

export function parseContentGapEvidence(rule: string, evidence: unknown): ContentGapFinding | null {
  switch (rule) {
    case 'content_gap_improve_page': {
      const parsed = contentGapImprovePageEvidenceSchema.safeParse(evidence);
      return parsed.success ? { rule_id: rule, evidence: parsed.data } : null;
    }
    case 'content_gap_new_page': {
      const parsed = contentGapNewPageEvidenceSchema.safeParse(evidence);
      return parsed.success ? { rule_id: rule, evidence: parsed.data } : null;
    }
    default:
      return null;
  }
}

const promptGap = promptGapEvidenceSchema;
const siteIssue = siteIssueEvidenceSchema;
const siteChange = siteChangeEvidenceSchema;
const demand = demandSignalEvidenceSchema;

export const opportunityEvidenceSchemas = {
  brand_absent_high_value_prompt: promptGap,
  owned_page_not_cited: promptGap,
  confirmed_prompt_decline: promptDeclineEvidenceSchema,
  earned_page_acquire_listing: earnedListingEvidenceSchema,
  site_contextual_links: contextualLinksEvidenceSchema,
  site_link_near_orphan: siteIssue,
  site_link_weak_authority: siteIssue,
  site_issue_family: siteIssueFamilyEvidenceSchema,
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
  content_gap_improve_page: contentGapImprovePageEvidenceSchema,
  content_gap_new_page: contentGapNewPageEvidenceSchema,
  product_not_mentioned: productMetricEvidenceSchema,
  price_mismatch: productMetricEvidenceSchema,
  losing_position: productMetricEvidenceSchema,
  merchant_absent: productMetricEvidenceSchema,
  catalog_fields_missing: catalogFieldsEvidenceSchema,
  cited_alternatives_without_uploaded_presence: citedAlternativesEvidenceSchema,
} as const;

export type OpportunityEvidence = z.input<
  (typeof opportunityEvidenceSchemas)[keyof typeof opportunityEvidenceSchemas]
>;
