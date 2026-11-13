/**
 * Request bodies of a project and its brand context: the project, its brand
 * profile, brand facts and business map. These own the wire shape; the API
 * `.extend`s each with its configured length and count bounds and defaults,
 * and the browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import { factStatusSchema, factTopicSchema } from './fact-checking.ts';
import {
  benchmarkModeSchema,
  businessModelSchema,
  buyerTypeSchema,
  entityMatchingModeSchema,
  marketScopeSchema,
} from './project.ts';

const text = () => z.string().trim();
const list = () => z.array(text());

export const competitorRequestSchema = z.object({
  name: text().min(1),
  aliases: list().default([]),
  domains: list().default([]),
});
/**
 * One row of the project editor's competitor list: a tracked competitor's
 * `id` keeps that competitor, its ID and logo, through a rename; a row
 * without one is matched by name or added.
 */
export const competitorListItemRequestSchema = competitorRequestSchema.extend({
  id: z.uuid().optional(),
});
/** One competitor added on its own; unknown fields are rejected. */
export const competitorCreateRequestSchema = competitorRequestSchema.strict();
/** A partial edit of one tracked competitor; absent fields are kept. */
export const competitorUpdateRequestSchema = z.strictObject({
  name: text().min(1).optional(),
  aliases: list().optional(),
  domains: list().optional(),
});

/** A mention rule to save, by brand or competitor name. */
export const entityMatchingRequestSchema = z.object({
  name: text().min(1),
  mode: entityMatchingModeSchema,
  context_terms: z.array(text().min(1)).default([]),
  exclusion_phrases: z.array(text().min(1)).default([]),
});

/** A new project. Omitted fields take the server's configured defaults. */
export const projectCreateRequestSchema = z.object({
  name: text().min(1),
  brand_name: text().optional(),
  website_url: text().optional(),
  industry: text().optional(),
  subindustry: text().optional(),
  primary_market: text().optional(),
  country_code: text().optional(),
  language_code: text().optional(),
  benchmark_mode: benchmarkModeSchema.optional(),
  default_repetitions: z.int().optional(),
  brand: z.object({ aliases: list().default([]) }).optional(),
  owned_domains: list().optional(),
  unintended_domains: list().optional(),
  competitors: z.array(competitorRequestSchema).optional(),
  description: text().optional(),
  positioning: text().optional(),
  target_audience: text().optional(),
  products_services: list().optional(),
  business_context: z.record(z.string(), z.unknown()).optional(),
});
export type ProjectCreateRequest = z.input<typeof projectCreateRequestSchema>;

/** A partial project edit; absent fields are kept. */
export const projectUpdateRequestSchema = z.object({
  name: text().min(1).optional(),
  brand_name: text().optional(),
  website_url: text().optional(),
  industry: text().optional(),
  subindustry: text().optional(),
  primary_market: text().optional(),
  country_code: text().optional(),
  language_code: text().optional(),
  benchmark_mode: benchmarkModeSchema.optional(),
  default_repetitions: z.int().optional(),
  brand: z.object({ aliases: list() }).optional(),
  owned_domains: list().optional(),
  unintended_domains: list().optional(),
  competitors: z.array(competitorListItemRequestSchema).optional(),
  // Names the project no longer tracks are dropped on save.
  entity_matching: z.array(entityMatchingRequestSchema).optional(),
});
export type ProjectUpdateRequest = z.input<typeof projectUpdateRequestSchema>;

/** One business-context list: short phrases; an empty list clears it. */
const contextList = () => z.array(text().min(1)).nullish();

/** A partial brand-profile edit: an absent or null field is left untouched. */
export const brandProfileUpdateRequestSchema = z.object({
  description: z.string().nullish(),
  positioning: z.string().nullish(),
  products_services: z.array(z.string()).nullish(),
  target_audience: z.string().nullish(),
  category: text().min(1).nullish(),
  buyer_type: buyerTypeSchema.nullish(),
  market_scope: marketScopeSchema.nullish(),
  business_model: businessModelSchema.nullish(),
  service_areas: contextList(),
  buyer_roles: contextList(),
  category_terms: contextList(),
  jobs_to_be_done: contextList(),
});
export type BrandProfileUpdateRequest = z.input<typeof brandProfileUpdateRequestSchema>;

const factSourceUrl = () => z.url({ protocol: /^https?$/u }).nullish();

export const brandFactCreateRequestSchema = z.object({
  topic: factTopicSchema,
  statement: text().min(1),
  source_url: factSourceUrl(),
});
export type BrandFactCreateRequest = z.input<typeof brandFactCreateRequestSchema>;

/** A partial edit of the revision the editor read; a stale revision is a 409. */
export const brandFactUpdateRequestSchema = z.object({
  expected_revision: z.int().positive(),
  topic: factTopicSchema.optional(),
  statement: text().min(1).optional(),
  // Null clears the source; absent keeps it.
  source_url: factSourceUrl(),
  status: factStatusSchema.optional(),
});
export type BrandFactUpdateRequest = z.input<typeof brandFactUpdateRequestSchema>;

const mapValue = () => text().min(1);
/**
 * One business-map entry. Keeping a suggestion unconfirmed is allowed; a new
 * entry is always a confirmed manual fact, whatever the request says.
 */
export const businessMapEntryRequestSchema = z.object({
  value: mapValue(),
  review_state: z.enum(['suggested', 'confirmed']).default('confirmed'),
});
export const businessMapExclusionRequestSchema = z.object({
  first: mapValue(),
  second: mapValue(),
});
export const businessMapOfferingRequestSchema = z.object({
  offering: mapValue(),
  attributes: z.array(businessMapEntryRequestSchema).default([]),
  situations: z.array(businessMapEntryRequestSchema).default([]),
  audiences: z.array(businessMapEntryRequestSchema).default([]),
  exclusions: z.array(businessMapExclusionRequestSchema).default([]),
});
/** One offering's complete edit, every list present: what the Prompt Builder drafts. */
export type BusinessMapOfferingEdit = z.infer<typeof businessMapOfferingRequestSchema>;
/** A full business-map edit: every offering's entries and exclusions; surviving entries keep their provenance. */
export const businessMapUpdateRequestSchema = z.object({
  offerings: z.array(businessMapOfferingRequestSchema).default([]),
});
export type BusinessMapUpdateRequest = z.input<typeof businessMapUpdateRequestSchema>;
