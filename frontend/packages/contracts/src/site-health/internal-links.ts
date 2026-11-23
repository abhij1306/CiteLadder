import { z } from 'zod';

const sourcePassageSchema = z.object({
  text: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const internalLinkPlacementSchema = sourcePassageSchema.extend({
  anchor: z.string(),
  anchor_start: z.number().int().nonnegative(),
});

export const internalLinkPageSchema = z.object({
  analysis_id: z.uuid(),
  artifact_id: z.uuid(),
  site_url_id: z.uuid(),
  url: z.string(),
  title: z.string(),
  h1: z.string(),
  description: z.string(),
  excerpt: z.string(),
  source_passages: z.array(sourcePassageSchema).nullable(),
  page_kind: z.string(),
  contextual_inbound: z.number().int().nonnegative().nullable(),
  contextual_targets: z.array(z.string()),
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
  anchor: z.string(),
  placement: internalLinkPlacementSchema.nullable().optional(),
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
export type InternalLinksInput = z.input<typeof internalLinksInputSchema>;

export type InternalLinkPage = z.infer<typeof internalLinkPageSchema>;
export type InternalLinkPlacement = z.infer<typeof internalLinkPlacementSchema>;
export type InternalLink = z.infer<typeof internalLinkSchema>;
export type InternalLinkAnalysis = z.infer<typeof internalLinkAnalysisSchema>;
