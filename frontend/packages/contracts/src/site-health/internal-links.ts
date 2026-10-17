import { z } from 'zod';

const sourcePassageSchema = z.object({
  text: z.string(),
  /** UTF-16 offsets in the artifact's primary_content_text. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const internalLinkPlacementSchema = sourcePassageSchema.extend({
  anchor: z.string(),
  /** UTF-16 offset within this passage. */
  anchor_start: z.number().int().nonnegative(),
});

/** One crawled page as frozen into an internal-link analysis. */
export const internalLinkPageSchema = z.object({
  analysis_id: z.uuid(),
  artifact_id: z.uuid(),
  site_url_id: z.uuid(),
  url: z.string(),
  title: z.string(),
  h1: z.string(),
  description: z.string(),
  excerpt: z.string(),
  /** Null when primary source text was unavailable or truncated. */
  source_passages: z.array(sourcePassageSchema).nullable(),
  page_kind: z.string(),
  /** Main-content links observed in the crawl; null when not measured. */
  contextual_inbound: z.number().int().nonnegative().nullable(),
  contextual_targets: z.array(z.string()),
  /** False when link capture was truncated, so a missing link is not provable. */
  links_complete: z.boolean(),
  eligible_target: z.boolean(),
  extractor_version: z.string(),
});

const internalLinkPageSummarySchema = internalLinkPageSchema.omit({
  contextual_targets: true,
  source_passages: true,
});

export const internalLinkSchema = z.object({
  id: z.uuid(),
  source: internalLinkPageSummarySchema,
  target: internalLinkPageSummarySchema,
  /** Exact phrase from the selected source placement. */
  anchor: z.string(),
  /** Omitted in historical saved results; new recommendations have a placement. */
  placement: internalLinkPlacementSchema.nullable().optional(),
  /** P(yes) that the source should link to the destination. */
  usefulness: z.number().min(0).max(1),
  action_id: z.uuid().nullable(),
  action_status: z.string().nullable(),
});

export const internalLinkAnalysisStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'unavailable',
  'cancelled',
  'failed',
]);

export const internalLinkAnalysisSchema = z.object({
  id: z.uuid(),
  crawl_id: z.uuid(),
  created_at: z.string(),
  state: internalLinkAnalysisStateSchema,
  page_count: z.number().int(),
  omitted_pages: z.number().int(),
  stale: z.boolean(),
  recommendations: z.array(internalLinkSchema),
  diagnostics: z
    .object({
      candidates: z.number().int(),
      completed: z.number().int(),
      pending: z.number().int(),
      unavailable: z.number().int(),
      below_threshold: z.number().int(),
      reasons: z.record(z.string(), z.number().int()),
      elapsed_seconds: z.number().nonnegative(),
      sources_without_passages: z.number().int().nonnegative().nullable().default(null),
    })
    .nullable()
    .default(null),
});

export const internalLinksReadSchema = z.object({
  history: z
    .array(
      z.object({ id: z.uuid(), created_at: z.string(), state: internalLinkAnalysisStateSchema }),
    )
    .default([]),
  analysis: internalLinkAnalysisSchema.nullable(),
  crawl_id: z.uuid().nullable(),
  availability: z.enum(['ready', 'crawl_required']),
});

export const internalLinksInputSchema = z.object({
  crawl_id: z.uuid(),
  idempotency_key: z.uuid(),
});

export type InternalLinkPage = z.infer<typeof internalLinkPageSchema>;
export type InternalLinkPlacement = z.infer<typeof internalLinkPlacementSchema>;
export type InternalLink = z.infer<typeof internalLinkSchema>;
export type InternalLinkAnalysis = z.infer<typeof internalLinkAnalysisSchema>;
