import { brandDiscoverySchema } from '@citeladder/contracts/visibility';
import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { categoryInput, competitorInput, marketInput } from './inputs.ts';

export function discoverySettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.discovery.settings;
  const setting = (name: keyof typeof spec) => resolveSettingSpec(spec[name], env);
  return Object.fromEntries(
    Object.keys(spec).map((key) => [key, setting(key as keyof typeof spec)]),
  ) as {
    [K in keyof typeof spec]: (typeof spec)[K]['default'] extends number ? number : string;
  };
}
export const discoveryCreate = z.object({
  brand_name: z.string().trim().min(1).max(255),
  website_url: z.string().trim().min(1).max(1024),
  industry: z.string().trim().max(255).default('General'),
  subindustry: z.string().trim().max(255).default(''),
  primary_market: marketInput,
  language_code: z.string().trim().max(16).default('en'),
});
const profile = policy.brand_identity;
const constants = policy.discovery.constants;
export const discoveryProfile = brandDiscoverySchema.shape.profile.extend({
  business_model: z
    .enum(constants.business_models as [string, ...string[]])
    .nullable()
    .default(null),
  secondary_business_models: z
    .array(z.enum(constants.business_models as [string, ...string[]]))
    .default([]),
  buyer_register: z
    .enum(constants.buyer_registers as [string, ...string[]])
    .nullable()
    .default(null),
  sector: z
    .enum(constants.sectors as [string, ...string[]])
    .nullable()
    .default(null),
  description: z.string().trim().max(profile.profile_text_max_chars).default(''),
  positioning: z.string().trim().max(profile.profile_text_max_chars).default(''),
  target_audience: z.string().trim().max(profile.profile_text_max_chars).default(''),
  products_services: z
    .array(z.string().trim().max(profile.profile_product_max_chars))
    .max(profile.profile_products_max_count)
    .default([]),
  industry: z.string().default('General'),
  business_type: z.enum(['b2b', 'b2c', 'both']).nullable().default(null),
  price_tier: z.enum(constants.price_tiers as [string, ...string[]]).default('unknown'),
  field_confidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
});
export const discoveryComplete = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  profile: discoveryProfile.extend({ category: categoryInput }),
  domains: z
    .array(z.string().trim().min(1).max(constants.discovery_confirm_domain_max_chars))
    .min(1)
    .max(constants.discovery_confirm_max_domains),
  competitors: z
    .array(
      competitorInput.extend({
        domains: z
          .array(z.string().trim().min(1).max(constants.discovery_confirm_domain_max_chars))
          .min(1)
          .max(constants.discovery_confirm_max_domains),
      }),
    )
    .max(profile.max_project_competitors)
    .default([]),
});
export const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string()
    .trim()
    .min(constants.discovery_idempotency_key_min_chars)
    .max(constants.discovery_idempotency_key_max_chars),
});
export type DiscoveryInput = z.output<typeof discoveryCreate>;
export type DiscoveryCompletion = z.output<typeof discoveryComplete>;
