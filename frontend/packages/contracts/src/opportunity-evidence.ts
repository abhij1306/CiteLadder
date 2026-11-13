/**
 * What each Opportunity rule stores as `evidence`: written by its producer in
 * the refresh, read by declaration checks and evidence views. One schema per
 * rule family; `opportunityEvidenceSchemas` names the schema of every rule.
 */
import { z } from 'zod';
import { keywordGapEvidenceSchema, sourcePatternSchema } from './opportunities.ts';
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

/**
 * The Site Health defects on one owned page that one finding folds together,
 * every one of them: several rules can map to one finding (SH-B2). `issues` is
 * in rule order, then issue id.
 */
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

/**
 * One Site Health issue family: one rule across the pages it fails on in one
 * crawl. `group_id` is the family's issue group in that crawl's catalog.
 * `pages` is the cohort a declaration freezes, in URL order and bounded;
 * `page_count` counts every affected page, so fewer listed pages means the
 * list was cut.
 */
export const issueFamilyCohortSchema = z.object({
  rule_id: z.string(),
  rule_label: z.string(),
  crawl_id: z.string(),
  group_id: z.string(),
  page_count: z.number().int(),
  pages: z.array(z.object({ site_url_id: z.string(), url: z.string() })),
});
export type IssueFamilyCohort = z.infer<typeof issueFamilyCohortSchema>;

/** A Site Health defect repeated across pages, as one finding. */
export const siteIssueFamilyEvidenceSchema = z.object({
  issue_rule_id: z.string(),
  issue_severity: z.string(),
  category: z.string(),
  cohort: issueFamilyCohortSchema,
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

/**
 * What every per-product metric rule stores: the product, the window the
 * Products read measured (ending at `as_of`), the metric's reading and the
 * threshold it failed, beside the row's own figures.
 */
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

/** The most cited pages a content-gap finding lists. */
export const CONTENT_GAP_EVIDENCE_MEMBERS = 20;

/** What both content-gap rules store: one angle of one succeeded content-angle run. */
const contentGapEvidenceSchema = z.object({
  run_id: z.string(),
  /** The angle's stable identity across reclustering; the label is not. */
  lineage_id: z.string(),
  angle_label: z.string(),
  /** Null for prompts without a topic. */
  topic_id: z.string().nullable(),
  /**
   * The angle's prompts with their text as the prompt library held it at the
   * refresh; `text` is null for a prompt the library no longer had then.
   */
  prompts: z.array(z.object({ id: z.string(), text: z.string().nullable() })),
  engines: z.array(z.string()),
  citation_count: z.number().int(),
  domain_count: z.number().int(),
  competitor_count: z.number().int(),
  /** Every cited page of the angle; `members` lists the most cited ones first. */
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
  /** The run's audit window. */
  window: z.object({ start: z.string(), end: z.string() }),
  methodology_version: z.string(),
  formula_version: z.string(),
  /** The run's recorded limitations (topicless prompts, empty titles, ...). */
  limitations: z.array(json),
});

/** An angle matched to an owned content page that is not cited for its prompts. */
const contentGapImprovePageEvidenceSchema = contentGapEvidenceSchema.extend({
  site_url_id: z.string(),
  url: z.string(),
  match_method: z.literal('model_pick'),
  /** The planned-page Action of the same lineage this page now continues. */
  continues_action_id: z.string().optional(),
});
export type ContentGapImprovePageEvidence = z.infer<typeof contentGapImprovePageEvidenceSchema>;

/** An angle no content page covers: a page to plan, keyed by its lineage's fixed key. */
const contentGapNewPageEvidenceSchema = contentGapEvidenceSchema.extend({
  planned_page_key: z.string(),
});
export type ContentGapNewPageEvidence = z.infer<typeof contentGapNewPageEvidenceSchema>;

/** Either content-gap rule's evidence. */
export const contentGapFindingEvidenceSchema = z.union([
  contentGapImprovePageEvidenceSchema,
  contentGapNewPageEvidenceSchema,
]);
export type ContentGapEvidence = z.infer<typeof contentGapFindingEvidenceSchema>;

/** A content-gap finding's rule with its evidence. */
export type ContentGapFinding =
  | { rule_id: 'content_gap_improve_page'; evidence: ContentGapImprovePageEvidence }
  | { rule_id: 'content_gap_new_page'; evidence: ContentGapNewPageEvidence };

/**
 * A finding's rule and stored evidence as a content-gap finding, or null when
 * the rule is not a content-gap rule or the evidence is not in its shape.
 */
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
