/**
 * Request bodies of Commerce: catalog import, competitor discovery and
 * decisions, and buyer prompts. These own the wire shape; the API `.extend`s
 * each with its configured byte, length and count bounds and defaults, and
 * the browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import {
  COMMERCE_TARGETS_MAX,
  commerceLifecycleStateSchema,
  commerceTargetSchema,
  commerceTargetsSchema,
  competitorCandidateSchema,
} from './commerce-suite.ts';

/**
 * The catalog CSV template's columns, in template order. `title` and `brand`
 * are required; `category` is a path (`A > B`), several separated by `|`.
 */
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
/**
 * Stage a catalog import from one of the three sources (CM3): the CSV
 * template, a Merchant Center feed file (CSV, TSV, XML or JSON) or a Shopify
 * storefront by its domain. The API bounds the content's size; nothing is
 * written to the catalog until the staged import is applied.
 */
export const catalogImportRequestSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('csv'), content: z.string(), filename: fileName }),
  z.strictObject({ source: z.literal('merchant_center'), content: z.string(), filename: fileName }),
  z.strictObject({ source: z.literal('shopify'), store: z.string().trim().min(1).max(255) }),
]);
export type CatalogImportRequest = z.input<typeof catalogImportRequestSchema>;

/** Apply a staged import, leaving out the proposed categories named by key. */
export const catalogImportApplyRequestSchema = z.strictObject({
  excluded_categories: z.array(z.string().min(1).max(255)),
});
export type CatalogImportApplyRequest = z.input<typeof catalogImportApplyRequestSchema>;

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

/**
 * Generate buyer prompts for targets. A category target yields its configured
 * matrix; a product target is accepted only as a hero pick (`hero`), with the
 * API bounding and defaulting `count` per hero product.
 */
export const buyerPromptGenerateRequestSchema = z.object({
  targets: commerceTargetsSchema,
  count: z.number().int().optional(),
  hero: z.boolean().optional(),
});
export type BuyerPromptGenerateRequest = z.input<typeof buyerPromptGenerateRequestSchema>;

/** One hand-written buyer prompt for a target; the API bounds the text. */
export const buyerPromptManualRequestSchema = z.object({
  target: z.object({ kind: commerceTargetSchema.shape.kind, id: z.uuid() }),
  text: z.string().trim().min(1),
});
export type BuyerPromptManualRequest = z.input<typeof buyerPromptManualRequestSchema>;

/**
 * Edit a catalog product: only the fields sent change, each recorded as an
 * edit that wins over CSV and crawl until a later import changes that field.
 * An empty identifier, currency or image clears it; `price: null` clears the
 * price; `categories` replaces the product's category set.
 */
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

/** Archive a catalog product, or restore it. */
export const productLifecycleRequestSchema = z.strictObject({
  lifecycle_state: commerceLifecycleStateSchema,
});
export type ProductLifecycleRequest = z.input<typeof productLifecycleRequestSchema>;

/** Approve or disapprove one buyer prompt. */
export const buyerPromptDecisionRequestSchema = z.object({ approved: z.boolean() });
export type BuyerPromptDecisionRequest = z.input<typeof buyerPromptDecisionRequestSchema>;
