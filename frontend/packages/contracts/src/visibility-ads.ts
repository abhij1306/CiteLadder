import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

const adApplicabilitySchema = z.enum(['applicable', 'unavailable', 'not_applicable']);
export const adOwnershipSchema = z.enum(['owned', 'competitor', 'other']);

const adsStateSchema = z.enum(['value', 'not_applicable', 'unavailable', 'no_answers']);

const adPresenceSchema = responseObject({
  answers: z.number().int(),
  answers_with_ads: z.number().int(),
  rate: z.number().nullable(),
});

const adEngineSchema = responseObject({
  engine: z.string(),
  applicability: adApplicabilitySchema,
  answers: z.number().int(),
  presence: adPresenceSchema.nullable(),
});

const adAdvertiserSchema = responseObject({
  name: z.string(),
  domain: z.string(),
  ownership: adOwnershipSchema,
  appearances: z.number().int(),
  prompts: z.number().int(),
  share: z.number(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
});

const adCreativeSchema = responseObject({
  advertiser_name: z.string(),
  advertiser_domain: z.string(),
  ownership: adOwnershipSchema,
  title: z.string(),
  snippet: z.string(),
  landing_url: z.string(),
  appearances: z.number().int(),
  prompts: z.number().int(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
});

const adPromptSchema = responseObject({
  prompt: z.string(),
  topic: z.string(),
  presence: adPresenceSchema,
  ads_seen: z.number().int(),
  top_advertiser: responseObject({ name: z.string(), domain: z.string() }).nullable(),
  competitor_ad_answers: responseObject({
    brand_mentioned: z.number().int(),
    brand_not_mentioned: z.number().int(),
  }),
});

const adBreakdownSchema = responseObject({
  key: z.string(),
  label: z.string(),
  presence: adPresenceSchema,
});

export const visibilityAdsResponseSchema = responseObject({
  state: adsStateSchema,
  source_audit_ids: z.array(uuid()),
  parser_versions: z.array(z.string()),
  metrics_version: z.string(),
  presence: adPresenceSchema,
  engines: z.array(adEngineSchema),
  brand: responseObject({
    appearances: z.number().int(),
    share: z.number().nullable(),
    best_rank: z.number().int().nullable(),
  }),
  advertisers_seen: z.number().int(),
  advertisers: z.array(adAdvertiserSchema),
  creatives: responseObject({
    items: z.array(adCreativeSchema),
    total: z.number().int(),
    next_cursor: z.string().nullable(),
  }),
  prompts: z.array(adPromptSchema),
  topics: z.array(adBreakdownSchema),
  runs: z.array(adBreakdownSchema),
});

export const executionAdsSchema = responseObject({
  applicability: adApplicabilitySchema,
  parser_version: z.string().nullable(),
  items: z.array(
    responseObject({
      rank_absolute: z.number().int(),
      advertiser_name: z.string(),
      advertiser_domain: z.string(),
      ownership: adOwnershipSchema,
      title: z.string(),
      snippet: z.string(),
      landing_url: z.string(),
    }),
  ),
});

export type AdOwnership = z.infer<typeof adOwnershipSchema>;
export type AdApplicability = z.infer<typeof adApplicabilitySchema>;
export type AdPresence = z.infer<typeof adPresenceSchema>;
export type VisibilityAdsResponse = z.infer<typeof visibilityAdsResponseSchema>;
export type ExecutionAds = z.infer<typeof executionAdsSchema>;
