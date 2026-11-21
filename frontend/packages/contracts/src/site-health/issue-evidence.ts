import { z } from 'zod';

const count = () => z.number().int();

const evidencePageSchema = z.object({
  site_url_id: z.string(),
  url: z.string(),
  title: z.string(),
  page_kind: z.string(),
});

const architectureShape = {
  count: count(),
  page_kind_counts: z.record(z.string(), count()),
  coverage_state: z.string(),
};

const pageListEvidenceSchema = z.object({
  ...architectureShape,
  pages: z.array(evidencePageSchema.extend({ depth_from_home: count().nullable() })),
});

const unreachablePagesEvidenceSchema = pageListEvidenceSchema.extend({
  sections: z.array(
    z.object({ path_prefix: z.string(), page_count: count(), example_url: z.string() }),
  ),
});

const pageKindShape = { page_kind: z.string(), page_count: count() };

const duplicateMetadataEvidenceSchema = z.object({
  ...architectureShape,
  duplicate_set_count: count(),
  duplicate_sets: z.array(
    z.object({ text: z.string(), page_count: count(), pages: z.array(evidencePageSchema) }),
  ),
});

const unhubbedPageKindEvidenceSchema = z.object({
  ...architectureShape,
  page_kinds: z.array(
    z.object({ ...pageKindShape, pages: z.array(evidencePageSchema).default([]) }),
  ),
});

const statusOutcome = { url: z.string(), status_code: count().nullable() };
const loopOutcome = { url: z.string(), reason: z.literal('redirect_limit') };
const redirectOutcome = { url: z.string(), final_url: z.string(), hops: count() };
const sitewideTargetOutcomeSchema = z.union([
  z.object(statusOutcome),
  z.object(loopOutcome),
  z.object(redirectOutcome),
]);
export type SitewideTargetOutcome = z.input<typeof sitewideTargetOutcomeSchema>;

const carriers = {
  linking_page_count: count(),
  pages: z.array(evidencePageSchema.extend({ artifact_id: z.string() })),
};

const sitewideLinkEvidenceSchema = z.object({
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
export type DuplicateMetadataEvidence = z.input<typeof duplicateMetadataEvidenceSchema>;
export type UnhubbedPageKindEvidence = z.input<typeof unhubbedPageKindEvidenceSchema>;
export type SitewideLinkEvidence = z.input<typeof sitewideLinkEvidenceSchema>;

export const siteLevelRuleSchema = z.enum([
  'architecture.excessive_depth',
  'architecture.breadcrumb_hierarchy_conflict',
  'architecture.orphan_pages',
  'architecture.parentless_detail_pages',
  'architecture.unreachable_from_home',
  'architecture.dead_end_pages',
  'architecture.duplicate_titles',
  'architecture.duplicate_meta_descriptions',
  'architecture.unhubbed_page_kind',
  'technical.sitewide_broken_link',
  'technical.sitewide_link_redirect',
]);
export type SiteLevelRule = z.infer<typeof siteLevelRuleSchema>;

export const siteLevelFindingSchema = z.discriminatedUnion('rule_id', [
  z.object({
    rule_id: siteLevelRuleSchema.extract([
      'architecture.excessive_depth',
      'architecture.breadcrumb_hierarchy_conflict',
      'architecture.orphan_pages',
      'architecture.parentless_detail_pages',
      'architecture.dead_end_pages',
    ]),
    evidence: pageListEvidenceSchema,
  }),
  z.object({
    rule_id: siteLevelRuleSchema.extract(['architecture.unreachable_from_home']),
    evidence: unreachablePagesEvidenceSchema,
  }),
  z.object({
    rule_id: siteLevelRuleSchema.extract([
      'architecture.duplicate_titles',
      'architecture.duplicate_meta_descriptions',
    ]),
    evidence: duplicateMetadataEvidenceSchema,
  }),
  z.object({
    rule_id: siteLevelRuleSchema.extract(['architecture.unhubbed_page_kind']),
    evidence: unhubbedPageKindEvidenceSchema,
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

export function siteLevelFinding(ruleId: string, evidence: unknown): SiteLevelFinding | null {
  return siteLevelRuleSchema.safeParse(ruleId).success
    ? siteLevelFindingSchema.parse({ rule_id: ruleId, evidence })
    : null;
}
