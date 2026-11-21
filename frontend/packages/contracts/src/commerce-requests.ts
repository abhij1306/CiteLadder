import { z } from 'zod';

import {
  COMMERCE_TARGETS_MAX,
  commerceLifecycleStateSchema,
  commerceTargetSchema,
  commerceTargetsSchema,
  competitorCandidateSchema,
} from './commerce-suite.ts';

export const CATALOG_TEMPLATE_COLUMNS = [
  'title',
  'brand',
  'description',
  'price',
  'currency',
  'link',
  'image_link',
  'category',
  'sku',
  'gtin',
] as const;
export const CATALOG_TEMPLATE_REQUIRED = ['title', 'brand'] as const;

const fileName = z.string().trim().min(1).max(255);
export const catalogImportRequestSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('csv'), content: z.string(), filename: fileName }),
  z.strictObject({ source: z.literal('merchant_center'), content: z.string(), filename: fileName }),
  z.strictObject({ source: z.literal('shopify'), store: z.string().trim().min(1).max(255) }),
]);
export type CatalogImportRequest = z.input<typeof catalogImportRequestSchema>;

export const catalogImportApplyRequestSchema = z.strictObject({
  excluded_categories: z.array(z.string().min(1).max(255)),
});
export type CatalogImportApplyRequest = z.input<typeof catalogImportApplyRequestSchema>;

export const competitorDiscoveryRequestSchema = z.object({
  targets: commerceTargetsSchema,
});
export type CompetitorDiscoveryRequest = z.input<typeof competitorDiscoveryRequestSchema>;

export const competitorDiscoveryExecuteRequestSchema = z.strictObject({
  task_ids: z.array(z.uuid()).min(1).max(COMMERCE_TARGETS_MAX),
});

export const competitorDecisionRequestSchema = z.object({
  decision: competitorCandidateSchema.shape.state.extract(['approved', 'rejected']),
});
export type CompetitorDecisionRequest = z.input<typeof competitorDecisionRequestSchema>;

export const buyerPromptGenerateRequestSchema = z.object({
  targets: commerceTargetsSchema,
  count: z.number().int().optional(),
  hero: z.boolean().optional(),
});
export type BuyerPromptGenerateRequest = z.input<typeof buyerPromptGenerateRequestSchema>;

export const buyerPromptManualRequestSchema = z.object({
  target: z.object({ kind: commerceTargetSchema.shape.kind, id: z.uuid() }),
  text: z.string().trim().min(1),
});
export type BuyerPromptManualRequest = z.input<typeof buyerPromptManualRequestSchema>;

export const productEditRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(512),
    brand: z.string().trim().max(255),
    description: z.string().trim(),
    price: z.number().nonnegative().max(999_999_999_999.99).nullable(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(?:[A-Z]{3})?$/u, 'A currency is a three-letter code'),
    canonical_url: z.url(),
    image_url: z.union([z.url(), z.literal('')]),
    sku: z.string().trim().max(255),
    gtin: z.string().trim().max(64),
    mpn: z.string().trim().max(255),
    categories: z.array(z.string().trim().min(1).max(255)),
  })
  .partial()
  .refine((edit) => Object.keys(edit).length > 0, 'An edit changes at least one field');
export type ProductEditRequest = z.input<typeof productEditRequestSchema>;

export const productLifecycleRequestSchema = z.strictObject({
  lifecycle_state: commerceLifecycleStateSchema,
});
export type ProductLifecycleRequest = z.input<typeof productLifecycleRequestSchema>;

export const buyerPromptDecisionRequestSchema = z.object({ approved: z.boolean() });
export type BuyerPromptDecisionRequest = z.input<typeof buyerPromptDecisionRequestSchema>;
