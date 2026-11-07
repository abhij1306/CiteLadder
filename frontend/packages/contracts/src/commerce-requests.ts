/**
 * Request bodies of Commerce: catalog import, competitor discovery and
 * decisions, and buyer prompts. These own the wire shape; the API `.extend`s
 * each with its configured byte, length and count bounds and defaults, and
 * the browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import {
  COMMERCE_TARGETS_MAX,
  commerceTargetSchema,
  commerceTargetsSchema,
  competitorCandidateSchema,
} from './commerce-suite.ts';

/** A catalog CSV upload; the API bounds its size. */
export const catalogImportRequestSchema = z.object({
  content: z.string(),
  filename: z.string().max(255).default('catalog.csv'),
  content_type: z.string().max(128).default('text/csv'),
});
export type CatalogImportRequest = z.input<typeof catalogImportRequestSchema>;

/** Queue one competitor discovery per target. */
export const competitorDiscoveryRequestSchema = z.object({
  targets: commerceTargetsSchema,
});
export type CompetitorDiscoveryRequest = z.input<typeof competitorDiscoveryRequestSchema>;

/** Run the named, already-admitted discovery tasks. */
export const competitorDiscoveryExecuteRequestSchema = z.strictObject({
  task_ids: z.array(z.uuid()).min(1).max(COMMERCE_TARGETS_MAX),
});

/** Approve or reject one discovered competitor. */
export const competitorDecisionRequestSchema = z.object({
  decision: competitorCandidateSchema.shape.state.extract(['approved', 'rejected']),
});
export type CompetitorDecisionRequest = z.input<typeof competitorDecisionRequestSchema>;

/** Generate buyer prompts for targets; the API bounds and defaults `count`. */
export const buyerPromptGenerateRequestSchema = z.object({
  targets: commerceTargetsSchema,
  count: z.number().int().optional(),
});
export type BuyerPromptGenerateRequest = z.input<typeof buyerPromptGenerateRequestSchema>;

/** One hand-written buyer prompt for a target; the API bounds the text. */
export const buyerPromptManualRequestSchema = z.object({
  target: z.object({ kind: commerceTargetSchema.shape.kind, id: z.uuid() }),
  text: z.string().trim().min(1),
});
export type BuyerPromptManualRequest = z.input<typeof buyerPromptManualRequestSchema>;

/** Approve or disapprove one buyer prompt. */
export const buyerPromptDecisionRequestSchema = z.object({ approved: z.boolean() });
export type BuyerPromptDecisionRequest = z.input<typeof buyerPromptDecisionRequestSchema>;
