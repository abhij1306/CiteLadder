import { z } from 'zod';

import { actionStatusSchema } from './actions.ts';

const uuid = z.uuid();
/** Targets one discovery or prompt-generation request may name: each is a paid search or model call. */
export const COMMERCE_TARGETS_MAX = 10;
export const commerceTargetSchema = z.strictObject({
  kind: z.enum(['category', 'product']),
  id: uuid,
});
/** The targets one discovery or prompt-generation request names. */
export const commerceTargetsSchema = z.array(commerceTargetSchema).min(1).max(COMMERCE_TARGETS_MAX);
export const commerceCategorySchema = z.strictObject({
  id: uuid,
  name: z.string(),
  role: z.enum(['hub', 'leaf', 'unknown']),
  canonical_url: z.string(),
  product_count: z.number().int(),
  field_sources: z.record(z.string(), z.unknown()),
  source_analysis_id: uuid.nullable(),
  projector_version: z.string(),
});
export const commerceProductSchema = z.strictObject({
  id: uuid,
  canonical_url: z.string(),
  name: z.string(),
  description: z.string(),
  brand: z.string(),
  price: z.number().nullable(),
  currency: z.string(),
  sku: z.string().nullable(),
  gtin: z.string().nullable(),
  mpn: z.string().nullable(),
  observed_external_id: z.string(),
  variants: z.array(z.unknown()),
  attributes: z.record(z.string(), z.unknown()),
  field_sources: z.record(z.string(), z.unknown()),
  lifecycle_state: z.enum(['active', 'archived']),
  category_ids: z.array(uuid),
  created_at: z.string(),
  updated_at: z.string(),
});
export const commerceCatalogSchema = z.strictObject({
  products: z.array(commerceProductSchema),
  categories: z.array(commerceCategorySchema),
  projection: z.strictObject({
    /** Whether crawled pages project into the catalog: only catalog-selling business models. */
    applies: z.boolean(),
    in_flight: z.number().int(),
    /** Failed or cancelled projections of the latest projected crawl. */
    failed: z.number().int(),
  }),
});
export const catalogImportSchema = z.strictObject({
  import_id: uuid,
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  rejected: z.number().int(),
  row_outcomes: z.array(
    z.strictObject({
      row_number: z.number().int(),
      status: z.enum(['created', 'updated', 'unchanged', 'rejected']),
      product_id: uuid.nullable(),
      error_code: z.string(),
      detail: z.string(),
    }),
  ),
});
export const competitorCandidateSchema = z.strictObject({
  id: uuid,
  target_kind: z.enum(['category', 'product']),
  target_id: uuid,
  canonical_url: z.string(),
  product_name: z.string(),
  brand_name: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  source_kind: z.string(),
  state: z.enum(['pending', 'approved', 'rejected', 'excluded']),
  decision_at: z.string().nullable(),
});
export const competitorDiscoverySchema = z.strictObject({ task_ids: z.array(uuid) });
export const competitorDiscoveryTaskSchema = z.strictObject({
  id: uuid,
  target: commerceTargetSchema,
  status: z.string(),
  error_code: z.string(),
  terminal: z.boolean(),
});
export const buyerPromptSchema = z.strictObject({
  id: uuid,
  prompt_set_id: uuid,
  target: commerceTargetSchema,
  text: z.string(),
  enabled: z.boolean(),
  approved_at: z.string().nullable(),
});
/** The latest measured snapshot of one target. */
const shelfSnapshotSchema = z.strictObject({
  /** Null when no execution for the target succeeded: unavailable, not zero. */
  product_visibility: z.number().nullable(),
  share_of_shelf: z.number().nullable(),
  average_shelf_position: z.number().nullable(),
  first_position_win_rate: z.number().nullable(),
  successful_execution_count: z.number().int(),
  recognized_slot_count: z.number().int(),
  ranked_execution_count: z.number().int(),
  measured_at: z.string(),
});
/** Who an answer recommended for the target, folded across the latest audit's executions. */
export const shelfHolderSchema = z.strictObject({
  kind: z.enum(['owned', 'approved_competitor', 'ai_observed_competitor']),
  name: z.string(),
  brand: z.string(),
  merchant_domain: z.string(),
  /** Executions whose answer recommended it. */
  appearances: z.number().int(),
  /** Its best position in an ordered answer, or null when no answer ordered it. */
  best_rank: z.number().int().nullable(),
});
const shelfActionSchema = z.strictObject({
  id: uuid,
  title: z.string(),
  status: actionStatusSchema,
});
export const shelfSchema = z.strictObject({
  target: commerceTargetSchema,
  snapshot: shelfSnapshotSchema.nullable(),
  holders: z.array(shelfHolderSchema),
  /** Recommendations in the latest audit that named nothing the catalog or competitors know. */
  unresolved_count: z.number().int(),
  /** Actions not yet done or dismissed whose evidence targets this product or category. */
  actions: z.array(shelfActionSchema),
});

export type CommerceTarget = z.infer<typeof commerceTargetSchema>;
export type CommerceCatalog = z.infer<typeof commerceCatalogSchema>;
export type CatalogImport = z.infer<typeof catalogImportSchema>;
export type CompetitorCandidate = z.infer<typeof competitorCandidateSchema>;
export type CompetitorDiscoveryTask = z.infer<typeof competitorDiscoveryTaskSchema>;
export type BuyerPrompt = z.infer<typeof buyerPromptSchema>;
export type Shelf = z.infer<typeof shelfSchema>;
