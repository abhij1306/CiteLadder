import { z } from 'zod';

import { factStatusSchema, factTopicSchema, overrideVerdictSchema } from './fact-checking.ts';
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
export const competitorListItemRequestSchema = competitorRequestSchema.extend({
  id: z.uuid().optional(),
});
export const competitorCreateRequestSchema = competitorRequestSchema.strict();
export const competitorUpdateRequestSchema = z.strictObject({
  name: text().min(1).optional(),
  aliases: list().optional(),
  domains: list().optional(),
});

export const entityMatchingRequestSchema = z.object({
  name: text().min(1),
  mode: entityMatchingModeSchema,
  context_terms: z.array(text().min(1)).default([]),
  exclusion_phrases: z.array(text().min(1)).default([]),
});

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
  entity_matching: z.array(entityMatchingRequestSchema).optional(),
});
export type ProjectUpdateRequest = z.input<typeof projectUpdateRequestSchema>;

const contextList = () => z.array(text().min(1)).nullish();

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

export const projectThemeRequestSchema = z.object({ name: text().min(1) });
export type ProjectThemeRequest = z.input<typeof projectThemeRequestSchema>;

const factSourceUrl = () => z.url({ protocol: /^https?$/u }).nullish();

export const brandFactCreateRequestSchema = z.object({
  topic: factTopicSchema,
  statement: text().min(1),
  source_url: factSourceUrl(),
});
export type BrandFactCreateRequest = z.input<typeof brandFactCreateRequestSchema>;

export const brandFactUpdateRequestSchema = z.object({
  expected_revision: z.int().positive(),
  topic: factTopicSchema.optional(),
  statement: text().min(1).optional(),
  source_url: factSourceUrl(),
  status: factStatusSchema.optional(),
});
export type BrandFactUpdateRequest = z.input<typeof brandFactUpdateRequestSchema>;

export const brandFactImportRequestSchema = z.object({
  rows: z.array(
    z.object({ topic: z.string(), statement: z.string(), source_url: z.string().nullable() }),
  ),
});
export type BrandFactImportRequest = z.input<typeof brandFactImportRequestSchema>;

export const verdictOverrideRequestSchema = z.object({
  verdict: overrideVerdictSchema,
  note: text().nullish(),
});
export type VerdictOverrideRequest = z.input<typeof verdictOverrideRequestSchema>;

const mapValue = () => text().min(1);
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
export type BusinessMapOfferingEdit = z.infer<typeof businessMapOfferingRequestSchema>;
export const businessMapUpdateRequestSchema = z.object({
  offerings: z.array(businessMapOfferingRequestSchema).default([]),
});
export type BusinessMapUpdateRequest = z.input<typeof businessMapUpdateRequestSchema>;
