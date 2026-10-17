import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Ads in AI answers — projections over persisted `answer_ad_observations` and
// the `response_analyses.ads_parser_version` marker. Ads are paid placements:
// they never enter citations, sources, mention rate, share of voice or scores.
// ---------------------------------------------------------------------------

// Per answer: `applicable` (parsed for ads, so zero ads is observed),
// `unavailable` (an ads engine whose answer was not parsed for ads) or
// `not_applicable` (an engine that does not show ads).
const adApplicabilitySchema = z.enum(['applicable', 'unavailable', 'not_applicable']);
export const adOwnershipSchema = z.enum(['owned', 'competitor', 'other']);

// `value`: at least one answer parsed for ads. `not_applicable`: the engine
// filter names an engine without ads. `unavailable`: ads-engine answers exist
// but none was parsed for ads. `no_answers`: no ads-engine answer in the selection.
const adsStateSchema = z.enum(['value', 'not_applicable', 'unavailable', 'no_answers']);

// Successful applicable answers, those with at least one ad, and their ratio
// (null without applicable answers).
const adPresenceSchema = responseObject({
  answers: z.number().int(),
  answers_with_ads: z.number().int(),
  rate: z.number().nullable(),
});

const adEngineSchema = responseObject({
  engine: z.string(),
  applicability: adApplicabilitySchema,
  answers: z.number().int(),
  // Null unless the engine's answers were parsed for ads.
  presence: adPresenceSchema.nullable(),
});

const adAdvertiserSchema = responseObject({
  name: z.string(),
  domain: z.string(),
  ownership: adOwnershipSchema,
  appearances: z.number().int(),
  prompts: z.number().int(),
  // Share of every ad appearance in the selection.
  share: z.number(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
});

// One creative: ads deduplicated on advertiser domain, title, snippet and the
// query-stripped landing URL. Text only; ad images are never served.
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
  // Answers where a competitor advertised, split by whether the brand was
  // mentioned organically in the same answer. Counts only, never a cause.
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
  // Parser versions behind the applicable answers, and the metrics version.
  parser_versions: z.array(z.string()),
  metrics_version: z.string(),
  presence: adPresenceSchema,
  engines: z.array(adEngineSchema),
  // The brand's own ads. Share and best rank are null when it never advertised.
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
  // Prompts whose answers surfaced at least one ad.
  prompts: z.array(adPromptSchema),
  topics: z.array(adBreakdownSchema),
  runs: z.array(adBreakdownSchema),
});

// The ads shown under one execution's answer, apart from its sources.
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
