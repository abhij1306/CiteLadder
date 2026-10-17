import { z } from 'zod';

import { responseObject, uuid } from './core.ts';

export const coverageStateSchema = z.enum(['complete', 'partial', 'unknown']);

export const architecturePageKindSchema = responseObject({
  page_kind: z.string(),
  page_count: z.number().int(),
  median_depth: z.number().nullable(),
  indexable_count: z.number().int(),
  duplicate_metadata_count: z.number().int(),
  orphan_count: z.number().int().nullable(),
});

export const architectureNodeSchema = responseObject({
  site_url_id: uuid(),
  url: z.string(),
  title: z.string(),
  page_kind: z.string(),
  parent_site_url_id: uuid().nullable(),
  parent_source: z.enum(['breadcrumb', 'explicit_structure', 'url_parent', 'unknown']),
  depth_from_home: z.number().int().nullable(),
});

const architectureOrphanPageSchema = responseObject({
  site_url_id: uuid(),
  url: z.string(),
  title: z.string(),
  page_kind: z.string(),
});

const architectureInternalLinkingSchema = responseObject({
  internal_link_count: z.number().int(),
  content_link_count: z.number().int(),
  pages_with_incoming_count: z.number().int(),
  pages_with_incoming_percentage: z.number().nullable(),
  // Null only on crawls persisted before orphan counts stopped being withheld
  // under partial coverage; a re-crawl re-derives them.
  orphan_page_count: z.number().int().nullable(),
  orphan_pages: z.array(architectureOrphanPageSchema).default([]),
});

const architectureDepthBucketSchema = responseObject({
  key: z.enum(['depth_0', 'depth_1', 'depth_2', 'depth_3_plus']),
  page_count: z.number().int(),
  percentage: z.number().nullable(),
});

const architectureStructureDepthSchema = responseObject({
  measured_page_count: z.number().int(),
  unmeasured_page_count: z.number().int(),
  buckets: z.array(architectureDepthBucketSchema),
});

export const architectureSchema = responseObject({
  state: z.enum(['available', 'unavailable']),
  crawl_id: uuid().nullable(),
  coverage_state: coverageStateSchema,
  page_count: z.number().int(),
  page_kinds: z.array(architecturePageKindSchema),
  nodes: z.array(architectureNodeSchema),
  internal_linking: architectureInternalLinkingSchema,
  structure_depth: architectureStructureDepthSchema,
  architecture_formula_version: z.string(),
  limitations: z.array(z.string()),
  coverage_reasons: z.array(z.string()).default([]),
});
