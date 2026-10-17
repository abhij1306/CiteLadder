import { z } from 'zod';

import { pageAnalysisStatusSchema, pageKindSchema } from './crawl.ts';
import { analysisSummaryFields } from './inventory.ts';
import { responseObject, uuid } from './core.ts';
import {
  findingClassSchema,
  issueDimensionSchema,
  issueSeveritySchema,
  issueOccurrenceSchema,
} from './issues.ts';
import { cursorPageSchema } from './pagination.ts';

// Deterministic HTTP delivery facts. `field_cwv_available` is a literal false —
// the HTTP-first crawler never fabricates field Core Web Vitals (no LCP/CLS/INP).
export const deliveryFactsSchema = responseObject({
  field_cwv_available: z.literal(false),
  status_code: z.number().int().nullable(),
  ttfb_ms: z.number().nullable(),
  wire_bytes: z.number().int().nullable(),
  decoded_bytes: z.number().int().nullable(),
  html_bytes: z.number().int().nullable(),
  http_version: z.string().nullable(),
  compression: z.string().nullable(),
  cache_control: z.string().nullable(),
  blocking_resource_count: z.number().int().nullable(),
});

// Bounded normalized page facts (deterministic; extractor-versioned).
const pageFactsSchema = responseObject({
  title: z.string().nullable(),
  meta_description: z.string().nullable(),
  canonical_url: z.string().nullable(),
  robots_directives: z.array(z.string()),
  h1_count: z.number().int(),
  heading_count: z.number().int(),
  image_count: z.number().int(),
  image_missing_alt_count: z.number().int(),
  word_count: z.number().int(),
  internal_link_count: z.number().int(),
  external_link_count: z.number().int(),
  structured_data_types: z.array(z.string()),
});

// Pages this crawl found linking to the URL, first sighting first and bounded
// by crawl policy. Empty for the root and sitemap-only URLs — never "nothing
// links here", which the link metrics own.
export const referrerSchema = responseObject({
  site_url_id: uuid(),
  url: z.string(),
});

// Analyzed-page summary row (`/pages` list). Scores/issue-count are null when
// analysis has not completed; `error_code` is '' when there is no error.
export const pageSummarySchema = responseObject({
  site_url_id: uuid(),
  crawl_id: uuid(),
  normalized_url: z.string(),
  display_url: z.string(),
  title: z.string().nullable(),
  monitored: z.boolean(),
  analysis_status: pageAnalysisStatusSchema,
  error_code: z.string(),
  linked_from: z.array(referrerSchema),
  ...analysisSummaryFields,
  // Persisted internal-link metrics for this crawl. `null` means UNMEASURED —
  // the crawl wrote no metric row for the URL — never "nothing links here".
  inbound_count: z.number().int().nullable(),
  main_content_inbound_count: z.number().int().nullable(),
  depth_from_home: z.number().int().nullable(),
});

// One REAL root-target network call the crawl lost. Deliberately
// NOT a page row: a root failure never creates a SiteUrl, so there is no
// `site_url_id` and no PageDetail link — the Errors & Blocked tab renders
// these as a distinct non-clickable block above the table.
export const rootErrorSchema = responseObject({
  method: z.string(),
  target: z.string(),
  outcome: z.string(),
  error_code: z.string(),
  status_code: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
});

export const pagesPageSchema = cursorPageSchema(pageSummarySchema).extend({
  // REQUIRED (backend always serializes); empty unless the crawl's root fetch
  // failed terminally. Never enters the keyset pagination of `items`.
  root_errors: z.array(rootErrorSchema),
});

// One persisted rule evaluation on a page (all outcomes, current label).
const ruleEvaluationSchema = responseObject({
  id: uuid(),
  rule_id: z.string(),
  title: z.string(),
  dimension: issueDimensionSchema,
  category: z.string(),
  severity: issueSeveritySchema,
  finding_class: findingClassSchema,
  outcome: z.enum(['satisfied', 'partial', 'missing', 'not_applicable', 'unknown', 'error']),
  display_applicability: z.boolean(),
  score_applicability: z.boolean(),
  checklist_membership: z.boolean(),
  reason_code: z.string(),
  score_roles: z.array(z.string()),
  aeo_pillar: z.string(),
  weight: z.number(),
  evidence: z.record(z.string(), z.unknown()),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
});

// One bounded top-N neighbour of a page in the crawl's internal link graph.
const linkNeighbourSchema = responseObject({
  site_url_id: uuid().nullable(),
  url: z.string(),
  anchor_count: z.number().int(),
  main_content: z.boolean(),
  nofollow: z.boolean(),
  rel: z.array(z.string()),
});

// A page's persisted internal-link metrics. `depth_from_home` is shortest-path
// over ALL followable internal links (a nav link is a real click);
// `main_content_inbound_count` is the separate "genuinely linked, or only in
// the menu" signal, taken from each anchor's DOM region — never from link
// frequency.
const anchorDiagnosticSchema = responseObject({
  kind: z.enum(['generic', 'repeated_destination', 'low_lexical_alignment']),
  anchor_text: z.string(),
  occurrences: z.number().int(),
  destination_count: z.number().int(),
  destinations: z.array(z.string()),
  regions: z.array(z.string()),
  title_coverage: z.number().nullable(),
  h1_coverage: z.number().nullable(),
});

const internalLinksSchema = responseObject({
  inbound_count: z.number().int(),
  outbound_count: z.number().int(),
  main_content_inbound_count: z.number().int(),
  main_content_outbound_count: z.number().int(),
  nofollow_inbound_count: z.number().int(),
  depth_from_home: z.number().int().nullable(),
  source_page_count: z.number().int(),
  authority_share: z.number().min(0).max(1),
  authority_rank: z.number().int().positive(),
  authority_scope: z.literal('observed_crawl'),
  observed_crawl_incomplete: z.boolean(),
  anchor_diagnostics: z.array(anchorDiagnosticSchema),
  top_inbound: z.array(linkNeighbourSchema),
  top_outbound: z.array(linkNeighbourSchema),
  formula_version: z.string(),
});

// Full analyzed-page detail (persisted facts/delivery/scores/issues/provenance).
export const pageDetailSchema = responseObject({
  url_hash: z.string().optional(),
  site_url_id: uuid(),
  crawl_id: uuid(),
  normalized_url: z.string(),
  display_url: z.string(),
  title: z.string().nullable(),
  analysis_status: pageAnalysisStatusSchema,
  error_code: z.string(),
  linked_from: z.array(referrerSchema),
  field_cwv_available: z.literal(false),
  web_fundamentals_score: z.number().nullable(),
  web_fundamentals_coverage: z.number().nullable(),
  web_fundamentals_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_readiness_score: z.number().nullable(),
  aeo_measurement_coverage: z.number().nullable(),
  aeo_measurement_state: z.enum(['measured', 'limited_evidence', 'not_measured', 'excluded']),
  aeo_measurement_reason: z.string(),
  main_content_indexable: z.boolean().nullable(),
  issue_count: z.number().int().nullable(),
  last_audited: z.string().nullable(),
  page_kind: pageKindSchema.nullable(),
  // Bounded classifier evidence behind page_kind ("why this kind?"
  // disclosure); null until the URL has an analysis.
  page_kind_evidence: z.record(z.string(), z.unknown()).nullable(),
  // Observed traits, independent of page_kind: a product page carrying an FAQ
  // has both. Empty once analyzed and nothing was observed; null before that.
  page_traits: z.array(z.string()).nullable(),
  // Pack-governed industry role. `null` = the pack classifier never ran.
  // A present object with `role_id: null` plus an `abstention_reason` is an
  // EXECUTED abstention — a different fact, rendered differently.
  facts: pageFactsSchema,
  delivery: deliveryFactsSchema,
  // Null when this crawl persisted no link metric for the URL.
  internal_links: internalLinksSchema.nullable(),
  issues: z.array(issueOccurrenceSchema),
  evaluations: z.array(ruleEvaluationSchema),
  artifact_id: uuid().nullable(),
  extractor_version: z.string(),
  analyzer_version: z.string(),
  rule_version: z.string(),
  scoring_version: z.string(),
});

// Identity/status returned by the per-page rerun (202). "Re-audit this page"
// is normally invoked from a COMPLETED (terminal) source crawl; the backend
// mints a fresh single-page rerun crawl in that case (`created_new_crawl`),
// so the client must poll the returned `crawl_id`/`site_url_id` (the fresh
// run) rather than the terminal source crawl it was invoked from.
export const rerunPageResponseSchema = responseObject({
  crawl_id: uuid(),
  site_url_id: uuid(),
  task_id: uuid(),
  created_new_crawl: z.boolean(),
  analysis_status: pageAnalysisStatusSchema,
});
