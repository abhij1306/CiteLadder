/**
 * What a site-level finding stores as evidence, by `rule_id`.
 *
 * Site-level findings (architecture rules and sitewide links) are judged over
 * the whole crawl and persisted once, against the homepage, with the pages,
 * page kinds or link targets they found. Their producers write these shapes
 * and the Issues view reads them; every other rule's evidence stays an open
 * record (`issueOccurrenceSchema.evidence`).
 */
import { z } from 'zod';

const count = () => z.number().int();

/** One affected page, as the evidence samples it. */
const evidencePageSchema = z.object({
  site_url_id: z.string(),
  url: z.string(),
  title: z.string(),
  page_kind: z.string(),
});

/** Fields every architecture finding records beside its bounded sample. */
const architectureShape = {
  // Every affected row, not the sample.
  count: count(),
  // Affected pages per page kind, over every row: the Issues page-kind filter counts by these.
  page_kind_counts: z.record(z.string(), count()),
  coverage_state: z.string(),
};

/** A finding about pages: the first `max_evidence_items` of them. */
const pageListEvidenceSchema = z.object({
  ...architectureShape,
  pages: z.array(evidencePageSchema.extend({ depth_from_home: count().nullable() })),
});

/** Pages no path from the homepage reaches, also grouped by section, largest first. */
const unreachablePagesEvidenceSchema = pageListEvidenceSchema.extend({
  sections: z.array(
    z.object({ path_prefix: z.string(), page_count: count(), example_url: z.string() }),
  ),
});

/** A finding about page kinds, each with its page and duplicate-metadata counts. */
const pageKindEvidenceSchema = z.object({
  ...architectureShape,
  page_kinds: z.array(
    z.object({ page_kind: z.string(), page_count: count(), duplicate_metadata_count: count() }),
  ),
});

/** Where a sitewide link goes wrong: an HTTP status (null when unanswered), a redirect, or a loop. */
const statusOutcome = { url: z.string(), status_code: count().nullable() };
const loopOutcome = { url: z.string(), reason: z.literal('redirect_limit') };
const redirectOutcome = { url: z.string(), final_url: z.string(), hops: count() };
const sitewideTargetOutcomeSchema = z.union([
  z.object(statusOutcome),
  z.object(loopOutcome),
  z.object(redirectOutcome),
]);
export type SitewideTargetOutcome = z.input<typeof sitewideTargetOutcomeSchema>;

/** The pages carrying one failing sitewide link: how many, and a bounded sample. */
const carriers = {
  linking_page_count: count(),
  pages: z.array(evidencePageSchema.extend({ artifact_id: z.string() })),
};

/** Failing sitewide link targets, each with the pages carrying it. */
const sitewideLinkEvidenceSchema = z.object({
  // Distinct pages carrying a failing link.
  count: count(),
  linking_page_kinds: z.array(z.string()),
  page_kind_counts: z.record(z.string(), count()),
  targets: z.array(
    z.union([
      z.object({ ...statusOutcome, ...carriers }),
      z.object({ ...loopOutcome, ...carriers }),
      z.object({ ...redirectOutcome, ...carriers }),
    ]),
  ),
  resolution_source_ids: z.array(z.string()),
});

export type PageListEvidence = z.input<typeof pageListEvidenceSchema>;
export type PageKindEvidence = z.input<typeof pageKindEvidenceSchema>;
export type SitewideLinkEvidence = z.input<typeof sitewideLinkEvidenceSchema>;

/** The rules whose finding is persisted once for the site. */
export const siteLevelRuleSchema = z.enum([
  'architecture.excessive_depth',
  'architecture.breadcrumb_hierarchy_conflict',
  'architecture.orphan_pages',
  'architecture.parentless_detail_pages',
  'architecture.unreachable_from_home',
  'architecture.duplicate_metadata_in_page_kind',
  'architecture.unhubbed_page_kind',
  'technical.sitewide_broken_link',
  'technical.sitewide_link_redirect',
]);
export type SiteLevelRule = z.infer<typeof siteLevelRuleSchema>;

/** One site-level finding's evidence, discriminated by its rule. */
export const siteLevelFindingSchema = z.discriminatedUnion('rule_id', [
  z.object({
    rule_id: siteLevelRuleSchema.extract([
      'architecture.excessive_depth',
      'architecture.breadcrumb_hierarchy_conflict',
      'architecture.orphan_pages',
      'architecture.parentless_detail_pages',
    ]),
    evidence: pageListEvidenceSchema,
  }),
  z.object({
    rule_id: siteLevelRuleSchema.extract(['architecture.unreachable_from_home']),
    evidence: unreachablePagesEvidenceSchema,
  }),
  z.object({
    rule_id: siteLevelRuleSchema.extract([
      'architecture.duplicate_metadata_in_page_kind',
      'architecture.unhubbed_page_kind',
    ]),
    evidence: pageKindEvidenceSchema,
  }),
  z.object({
    rule_id: siteLevelRuleSchema.extract([
      'technical.sitewide_broken_link',
      'technical.sitewide_link_redirect',
    ]),
    evidence: sitewideLinkEvidenceSchema,
  }),
]);
export type SiteLevelFinding = z.infer<typeof siteLevelFindingSchema>;

/**
 * A site-level finding's evidence, typed by its rule, or `null` for a per-page
 * rule. Throws when a site-level rule's evidence breaks its contract.
 */
export function siteLevelFinding(ruleId: string, evidence: unknown): SiteLevelFinding | null {
  return siteLevelRuleSchema.safeParse(ruleId).success
    ? siteLevelFindingSchema.parse({ rule_id: ruleId, evidence })
    : null;
}
