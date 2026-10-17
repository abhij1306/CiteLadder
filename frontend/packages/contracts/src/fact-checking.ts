import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Fact-checking (gated pilot): user-owned brand facts, and the verdicts on the
// factual claims answers make about the brand. Projections over persisted
// `answer_claims` / `claim_verdicts`; missing data is a state, never a zero.
// ---------------------------------------------------------------------------

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
// Only `confirmed` facts are checked against; `retired` keeps the history.
export const factStatusSchema = z.enum(['draft', 'confirmed', 'retired']);

export const brandFactSchema = responseObject({
  id: uuid(),
  topic: factTopicSchema,
  statement: z.string(),
  source_url: z.string().nullable(),
  status: factStatusSchema,
  // Increments on every change; an edit must name the revision it read.
  revision: z.number().int(),
  updated_at: z.string(),
});

// `enabled` is false for a workspace outside the fact-checking pilot; the
// list is then empty and writes are refused.
export const brandFactListSchema = responseObject({
  enabled: z.boolean(),
  facts: z.array(brandFactSchema),
});

// A claim's verdict against the confirmed facts frozen when its run started.
export const claimVerdictSchema = z.enum([
  'supported',
  'contradicted',
  'inconclusive',
  'not_covered',
]);

// Why a claim has no verdict.
export const claimUnavailableReasonSchema = z.enum([
  'model_not_configured',
  'platform_cap',
  'invalid_output',
  'model_error',
  'task_failed',
]);

// `value`: at least one verdict. `not_enabled`: the workspace is outside the
// pilot. `no_facts`: no selected run had confirmed facts when it started.
// `no_claims`: answers named the brand without a checkable factual claim.
// `pending`: claims are waiting for extraction or verification.
// `unavailable`: nothing could be checked (see `reason`).
const accuracyStateSchema = z.enum([
  'value',
  'not_enabled',
  'no_facts',
  'no_claims',
  'pending',
  'unavailable',
]);

// Every extracted brand claim lands in exactly one bucket.
export const accuracyCoverageSchema = responseObject({
  claims: z.number().int(),
  supported: z.number().int(),
  contradicted: z.number().int(),
  inconclusive: z.number().int(),
  not_covered: z.number().int(),
  // Claims or verdicts below the confidence floor; never counted as verdicts.
  low_confidence: z.number().int(),
  pending: z.number().int(),
  unavailable: z.array(
    responseObject({ reason: claimUnavailableReasonSchema, count: z.number().int() }),
  ),
  // Answers naming the brand whose claims are not extracted yet, or could not be.
  answers_pending: z.number().int(),
  answers_unavailable: z.number().int(),
});

// supported ÷ (supported + contradicted); null when neither occurred.
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

// One claim an answer made about the brand: its quote is an exact substring
// of the answer, and `facts` are the frozen fact revisions the verdict cites.
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
  // Link target: `/runs/{run_id}?execution={execution_id}`.
  run_id: uuid(),
  execution_id: uuid(),
  observed_at: z.string(),
});

// URLs cited in answers that carry a contradicted claim: cited alongside the
// claim, never shown to be its source.
const accuracyCitedSchema = responseObject({
  domain: z.string(),
  answers: z.number().int(),
  example_url: z.string().nullable(),
});

const accuracyTrendPointSchema = responseObject({
  audit_id: uuid(),
  completed_at: z.string(),
  score: accuracyScoreSchema,
  // False when the templates, metrics version or fact set differ from the previous point's.
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

export const accuracyClaimPageSchema = responseObject({
  items: z.array(accuracyClaimSchema),
  next_cursor: z.string().nullable(),
});

// The brand claims of one execution, with offsets for highlighting.
export const executionClaimSchema = accuracyClaimSchema
  .omit({ logical_engine: true, prompt: true, run_id: true, execution_id: true, observed_at: true })
  .extend({
    // Code-point offsets into the answer text.
    start: z.number().int(),
    end: z.number().int(),
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
export type ExecutionClaim = z.infer<typeof executionClaimSchema>;
