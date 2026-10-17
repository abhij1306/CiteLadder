import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Answer perception (sentiment, themes, recommended rate) — projections over
// persisted `answer_perceptions` / `entity_sentiments` and the deterministic
// entity assessments. Missing data is a state, never a zero.
// ---------------------------------------------------------------------------

export const perceptionLabelSchema = z.enum([
  'positive',
  'neutral',
  'negative',
  'mixed',
  'not_assessable',
]);
const perceptionPolaritySchema = z.enum(['positive', 'negative']);

// Why a mention has no usable label. `platform_cap` and `model_not_configured`
// are bounded platform outcomes; `task_failed` is a worker that gave up;
// `entity_limit` is a business beyond the per-answer classification cap.
const perceptionUnavailableReasonSchema = z.enum([
  'model_not_configured',
  'platform_cap',
  'entity_limit',
  'invalid_output',
  'model_error',
  'task_failed',
  'not_assessable',
]);

// `value`: at least one confident label. `pending`: mentions are waiting for
// classification. `unavailable`: nothing classifiable (see `reason`).
// `no_mentions`: no completed answer in the selection named the brand.
const perceptionStateSchema = z.enum(['value', 'pending', 'unavailable', 'no_mentions']);

// "N of M mentions classified": every mention lands in exactly one bucket.
export const perceptionCoverageSchema = responseObject({
  mentions: z.number().int(),
  classified: z.number().int(),
  pending: z.number().int(),
  not_assessable: z.number().int(),
  low_confidence: z.number().int(),
  unavailable: z.array(
    responseObject({ reason: perceptionUnavailableReasonSchema, count: z.number().int() }),
  ),
});

// Label counts over classified mentions. Shares and net sentiment are null
// when nothing was classified; `mixed` counts only in the denominator.
export const perceptionScoreSchema = responseObject({
  positive: z.number().int(),
  neutral: z.number().int(),
  negative: z.number().int(),
  mixed: z.number().int(),
  classified: z.number().int(),
  positive_share: z.number().nullable(),
  negative_share: z.number().nullable(),
  net_sentiment: z.number().nullable(),
});

export const perceptionEntitySchema = responseObject({
  name: z.string(),
  is_brand: z.boolean(),
  score: perceptionScoreSchema,
  coverage: perceptionCoverageSchema,
});

export const perceptionBreakdownSchema = responseObject({
  key: z.string(),
  label: z.string(),
  score: perceptionScoreSchema,
  coverage: perceptionCoverageSchema,
});

// A verified quote: an exact substring of the answer passage it came from.
export const perceptionQuoteSchema = responseObject({
  text: z.string(),
  theme: z.string(),
  polarity: perceptionPolaritySchema,
  entity: z.string(),
  is_brand: z.boolean(),
  logical_engine: z.string(),
  prompt: z.string(),
  // Link target: `/runs/{run_id}?execution={execution_id}`.
  run_id: uuid(),
  execution_id: uuid(),
  observed_at: z.string(),
  // The versions that produced this quote (frozen at the run's admission).
  extractor_version: z.string(),
  template_version: z.string(),
});

const perceptionThemeSchema = responseObject({
  theme: z.string(),
  positive: z.number().int(),
  negative: z.number().int(),
  quotes: z.array(perceptionQuoteSchema),
});

// Sources cited in answers where the brand drew a negative aspect. These are
// cited alongside the criticism, never shown to have caused it.
const perceptionDriverSchema = responseObject({
  domain: z.string(),
  answers: z.number().int(),
  example_url: z.string().nullable(),
});

// Deterministic first-mention recommendation reading (English phrasing only).
const perceptionRecommendedSchema = responseObject({
  mentioned: z.number().int(),
  recommended: z.number().int(),
  recommended_against: z.number().int(),
  rate: z.number().nullable(),
  limitation: z.string(),
});

const perceptionTrendPointSchema = responseObject({
  audit_id: uuid(),
  completed_at: z.string(),
  score: perceptionScoreSchema,
  mentions: z.number().int(),
  extractor_version: z.string(),
  template_version: z.string(),
  metrics_version: z.string(),
  // False when this point's versions differ from the previous point's.
  comparable: z.boolean(),
});

export const perceptionResponseSchema = responseObject({
  state: perceptionStateSchema,
  reason: perceptionUnavailableReasonSchema.nullable(),
  source_audit_ids: z.array(uuid()),
  brand: perceptionEntitySchema.nullable(),
  coverage: perceptionCoverageSchema,
  entities: z.array(perceptionEntitySchema),
  engines: z.array(perceptionBreakdownSchema),
  topics: z.array(perceptionBreakdownSchema),
  prompts: z.array(perceptionBreakdownSchema),
  themes: z.array(perceptionThemeSchema),
  negative_quotes: z.array(perceptionQuoteSchema),
  drivers: z.array(perceptionDriverSchema),
  recommended: perceptionRecommendedSchema,
  trend: z.array(perceptionTrendPointSchema),
});

export const perceptionQuotePageSchema = responseObject({
  items: z.array(perceptionQuoteSchema),
  next_cursor: z.string().nullable(),
});

// Per-entity perception on one execution's evidence.
export const executionPerceptionSchema = responseObject({
  entity: z.string(),
  is_brand: z.boolean(),
  state: z.enum(['classified', 'not_assessable', 'low_confidence', 'pending', 'unavailable']),
  reason: perceptionUnavailableReasonSchema.nullable(),
  label: perceptionLabelSchema.nullable(),
  confidence: z.number().nullable(),
  // The versions this answer is classified under (frozen at the run's admission).
  extractor_version: z.string(),
  template_version: z.string(),
  aspects: z.array(
    responseObject({
      theme: z.string(),
      polarity: perceptionPolaritySchema,
      quote: z.string(),
      // Code-point offsets into the answer text.
      start: z.number().int(),
      end: z.number().int(),
    }),
  ),
});

export type PerceptionResponse = z.infer<typeof perceptionResponseSchema>;
export type PerceptionQuote = z.infer<typeof perceptionQuoteSchema>;
export type PerceptionScore = z.infer<typeof perceptionScoreSchema>;
export type PerceptionCoverage = z.infer<typeof perceptionCoverageSchema>;
export type ExecutionPerception = z.infer<typeof executionPerceptionSchema>;
