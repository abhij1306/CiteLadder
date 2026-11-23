import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

export const factTopicSchema = z.enum([
  'pricing',
  'plans',
  'integrations',
  'availability',
  'markets',
  'policies',
  'specs',
  'company',
]);
export const factStatusSchema = z.enum(['draft', 'confirmed', 'retired']);

export const brandFactSchema = responseObject({
  id: uuid(),
  topic: factTopicSchema,
  statement: z.string(),
  source_url: z.string().nullable(),
  status: factStatusSchema,
  revision: z.number().int(),
  updated_at: z.string(),
});

export const brandFactListSchema = responseObject({
  enabled: z.boolean(),
  facts: z.array(brandFactSchema),
  limits: responseObject({
    statement_max_chars: z.number().int(),
    facts_import_max_rows: z.number().int(),
  }),
});

export const claimVerdictSchema = z.enum([
  'supported',
  'contradicted',
  'inconclusive',
  'not_covered',
]);

export const claimUnavailableReasonSchema = z.enum([
  'model_not_configured',
  'platform_cap',
  'invalid_output',
  'model_error',
  'task_failed',
  'model_omitted',
  'model_changed',
]);

const accuracyStateSchema = z.enum([
  'value',
  'not_enabled',
  'no_facts',
  'no_claims',
  'pending',
  'unavailable',
]);

export const accuracyCoverageSchema = responseObject({
  claims: z.number().int(),
  supported: z.number().int(),
  contradicted: z.number().int(),
  inconclusive: z.number().int(),
  not_covered: z.number().int(),
  low_confidence: z.number().int(),
  pending: z.number().int(),
  unavailable: z.array(
    responseObject({ reason: claimUnavailableReasonSchema, count: z.number().int() }),
  ),
  answers_pending: z.number().int(),
  answers_unavailable: z.number().int(),
  edited: z.number().int(),
});

export const accuracyScoreSchema = responseObject({
  accuracy: z.number().nullable(),
  coverage: accuracyCoverageSchema,
});

const accuracyBreakdownSchema = responseObject({
  key: z.string(),
  label: z.string(),
  score: accuracyScoreSchema,
});

const factReferenceSchema = responseObject({
  topic: factTopicSchema,
  statement: z.string(),
  source_url: z.string().nullable(),
});

export const accuracyClaimSchema = responseObject({
  claim: z.string(),
  topic: factTopicSchema,
  quote: z.string(),
  status: z.enum(['verdict', 'low_confidence', 'pending', 'unavailable']),
  verdict: claimVerdictSchema.nullable(),
  reason: claimUnavailableReasonSchema.nullable(),
  facts: z.array(factReferenceSchema),
  logical_engine: z.string(),
  prompt: z.string(),
  run_id: uuid(),
  execution_id: uuid(),
  observed_at: z.string(),
  verdict_id: uuid().nullable(),
  edited: z
    .object({ model_verdict: claimVerdictSchema, note: z.string().nullable(), at: z.string() })
    .nullable(),
});

export const overrideVerdictSchema = z.enum(['supported', 'contradicted', 'inconclusive']);

const accuracyCitedSchema = responseObject({
  domain: z.string(),
  answers: z.number().int(),
  example_url: z.string().nullable(),
});

const accuracyTrendPointSchema = responseObject({
  audit_id: uuid(),
  completed_at: z.string(),
  score: accuracyScoreSchema,
  comparable: z.boolean(),
});

export const accuracyResponseSchema = responseObject({
  state: accuracyStateSchema,
  reason: claimUnavailableReasonSchema.nullable(),
  source_audit_ids: z.array(uuid()),
  score: accuracyScoreSchema,
  topics: z.array(accuracyBreakdownSchema),
  engines: z.array(accuracyBreakdownSchema),
  contradicted: z.array(accuracyClaimSchema),
  cited_alongside: z.array(accuracyCitedSchema),
  trend: z.array(accuracyTrendPointSchema),
});

const factClaimCountsSchema = z.discriminatedUnion('kind', [
  responseObject({
    kind: z.literal('raised'),
    claims: z.number().int(),
    supported: z.number().int(),
    contradicted: z.number().int(),
    inconclusive: z.number().int(),
    last_raised_at: z.string(),
  }),
  responseObject({ kind: z.literal('not_raised') }),
  responseObject({ kind: z.literal('pending') }),
]);

export const accuracyFactSchema = responseObject({
  revision_id: uuid(),
  fact_id: uuid(),
  revision: z.number().int(),
  topic: factTopicSchema,
  statement: z.string(),
  counts: factClaimCountsSchema,
});

export const accuracyFactListSchema = responseObject({
  enabled: z.boolean(),
  facts: z.array(accuracyFactSchema),
});

export const accuracyClaimPageSchema = responseObject({
  items: z.array(accuracyClaimSchema),
  next_cursor: z.string().nullable(),
});

export const executionClaimSchema = accuracyClaimSchema
  .omit({
    logical_engine: true,
    prompt: true,
    run_id: true,
    execution_id: true,
    observed_at: true,
    verdict_id: true,
    edited: true,
  })
  .extend({
    start: z.number().int(),
    end: z.number().int(),
  });

export const verdictOverrideSchema = responseObject({
  verdict_id: uuid(),
  model_verdict: claimVerdictSchema,
  verdict: overrideVerdictSchema,
  note: z.string().nullable(),
  at: z.string(),
});

export const brandFactImportResultSchema = responseObject({
  rows: z.array(
    z.discriminatedUnion('kind', [
      responseObject({ index: z.number().int(), kind: z.literal('created'), fact_id: uuid() }),
      responseObject({ index: z.number().int(), kind: z.literal('duplicate') }),
      responseObject({ index: z.number().int(), kind: z.literal('invalid'), message: z.string() }),
    ]),
  ),
});

export type FactTopic = z.infer<typeof factTopicSchema>;
export type FactStatus = z.infer<typeof factStatusSchema>;
export type BrandFact = z.infer<typeof brandFactSchema>;
export type BrandFactList = z.infer<typeof brandFactListSchema>;
export type ClaimVerdict = z.infer<typeof claimVerdictSchema>;
export type AccuracyResponse = z.infer<typeof accuracyResponseSchema>;
export type AccuracyCoverage = z.infer<typeof accuracyCoverageSchema>;
export type AccuracyScore = z.infer<typeof accuracyScoreSchema>;
export type AccuracyClaim = z.infer<typeof accuracyClaimSchema>;
export type AccuracyFact = z.infer<typeof accuracyFactSchema>;
export type AccuracyFactList = z.infer<typeof accuracyFactListSchema>;
export type ExecutionClaim = z.infer<typeof executionClaimSchema>;
export type AccuracyClaimPage = z.infer<typeof accuracyClaimPageSchema>;
export type OverrideVerdict = z.infer<typeof overrideVerdictSchema>;
export type VerdictOverride = z.infer<typeof verdictOverrideSchema>;
export type BrandFactImportResult = z.infer<typeof brandFactImportResultSchema>;
