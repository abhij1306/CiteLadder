import { z } from 'zod';

import { brandMarkFields } from './brand-mark.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

export const perceptionLabelSchema = z.enum([
  'positive',
  'neutral',
  'negative',
  'mixed',
  'not_assessable',
]);
const perceptionPolaritySchema = z.enum(['positive', 'negative']);

const perceptionUnavailableReasonSchema = z.enum([
  'model_not_configured',
  'platform_cap',
  'entity_limit',
  'invalid_output',
  'model_error',
  'task_failed',
  'not_assessable',
  'model_omitted',
  'model_changed',
]);

export const perceptionAttributeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('labelled'), name: z.string() }),
    z.object({ kind: z.literal('not_found') }),
    z.object({ kind: z.literal('not_labelled') }),
  ])
  .describe(
    'What the answer says about the business in plain buyer words. not_found: labelled, but the model gave no usable attribute. not_labelled: labelled before attributes existed; only its category is known.',
  );

const perceptionStateSchema = z.enum(['value', 'pending', 'unavailable', 'no_mentions']);

export const perceptionCoverageSchema = responseObject({
  mentions: z.number().int().describe('Mentions in the selection; each lands in one bucket below.'),
  classified: z.number().int().describe('Labelled with enough confidence to count.'),
  pending: z.number().int().describe('Waiting for classification.'),
  not_assessable: z.number().int().describe('Read, but carrying no tone to judge.'),
  low_confidence: z.number().int().describe('Labelled below the confidence floor: not counted.'),
  unavailable: z
    .array(responseObject({ reason: perceptionUnavailableReasonSchema, count: z.number().int() }))
    .describe('Mentions that could not be classified, by reason.'),
});

const SHARE_OF_CLASSIFIED = 'over `classified`, 0–1. Null: nothing classified.';
export const perceptionScoreSchema = responseObject({
  positive: z.number().int(),
  neutral: z.number().int(),
  negative: z.number().int(),
  mixed: z.number().int(),
  classified: z.number().int().describe('All four labels together: the denominator.'),
  positive_share: z.number().nullable().describe(`\`positive\` ${SHARE_OF_CLASSIFIED}`),
  negative_share: z.number().nullable().describe(`\`negative\` ${SHARE_OF_CLASSIFIED}`),
  net_sentiment: z
    .number()
    .nullable()
    .describe('(positive − negative) / classified × 100, −100 to 100. Null: nothing classified.'),
});

export const perceptionQuoteSchema = responseObject({
  text: z.string(),
  theme: z.string(),
  attribute: perceptionAttributeSchema,
  polarity: perceptionPolaritySchema,
  entity: z.string(),
  is_brand: z.boolean(),
  logical_engine: z.string(),
  prompt: z.string(),
  run_id: uuid(),
  execution_id: uuid(),
  observed_at: z.string(),
  extractor_version: z.string(),
  template_version: z.string(),
});

const perceptionCategorySchema = responseObject({
  category: z.string(),
  mentions: z.number().int().describe('Classified mentions raising the category at least once.'),
  positive: z.number().int(),
  negative: z.number().int(),
  attributes: z
    .array(
      responseObject({
        attribute: z.string(),
        positive: z.number().int(),
        negative: z.number().int(),
        quotes: z
          .array(perceptionQuoteSchema)
          .describe("A few of the answers' own words; the brand's only, empty for a competitor."),
      }),
    )
    .describe('The most raised attributes, labelled ones only.'),
});

export const perceptionEntitySchema = responseObject({
  name: z.string(),
  is_brand: z.boolean(),
  ...brandMarkFields,
  score: perceptionScoreSchema,
  coverage: perceptionCoverageSchema,
  theme_mentions: z
    .array(responseObject({ theme: z.string(), mentions: z.number().int() }))
    .describe('Per theme, the classified mentions raising it at least once.'),
  categories: z.array(perceptionCategorySchema),
});

export const perceptionBreakdownSchema = responseObject({
  key: z.string().describe('The engine, topic or prompt this row covers.'),
  label: z.string(),
  score: perceptionScoreSchema,
  coverage: perceptionCoverageSchema,
});

const perceptionThemeSchema = responseObject({
  theme: z.string(),
  positive: z.number().int(),
  negative: z.number().int(),
  quotes: z.array(perceptionQuoteSchema),
});

const perceptionDriverSchema = responseObject({
  domain: z.string(),
  answers: z
    .number()
    .int()
    .describe('Answers with a negative aspect of the brand that cited it: alongside, not a cause.'),
  example_url: z.string().nullable(),
});

const perceptionRecommendedSchema = responseObject({
  mentioned: z.number().int().describe('Answers that named the brand.'),
  recommended: z.number().int(),
  recommended_against: z.number().int(),
  rate: z.number().nullable().describe('`recommended` / `mentioned`, 0–1. Null: no mention.'),
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
  comparable: z.boolean().describe("False when this point's versions differ from the previous."),
});

export const perceptionResponseSchema = responseObject({
  state: perceptionStateSchema.describe(
    '`value`: at least one confident label. `pending`: waiting for classification. `unavailable`: nothing classifiable (see `reason`). `no_mentions`: no answer named the brand.',
  ),
  reason: perceptionUnavailableReasonSchema.nullable(),
  source_audit_ids: z.array(uuid()).describe('The runs this read counts.'),
  brand: perceptionEntitySchema.nullable(),
  coverage: perceptionCoverageSchema,
  entities: z.array(perceptionEntitySchema).describe('The brand and each competitor named.'),
  engines: z.array(perceptionBreakdownSchema).describe("The brand's tone per engine."),
  topics: z.array(perceptionBreakdownSchema).describe("The brand's tone per topic."),
  prompts: z.array(perceptionBreakdownSchema).describe("The brand's tone per prompt."),
  themes: z.array(perceptionThemeSchema),
  negative_quotes: z.array(perceptionQuoteSchema),
  drivers: z
    .array(perceptionDriverSchema)
    .describe('Sources cited alongside negative aspects of the brand.'),
  recommended: perceptionRecommendedSchema,
  trend: z.array(perceptionTrendPointSchema),
});

export const perceptionQuotePageSchema = responseObject({
  items: z.array(perceptionQuoteSchema),
  next_cursor: z.string().nullable(),
});

export const executionPerceptionSchema = responseObject({
  entity: z.string(),
  is_brand: z.boolean(),
  state: z.enum(['classified', 'not_assessable', 'low_confidence', 'pending', 'unavailable']),
  reason: perceptionUnavailableReasonSchema.nullable(),
  label: perceptionLabelSchema.nullable(),
  confidence: z.number().nullable(),
  extractor_version: z.string(),
  template_version: z.string(),
  aspects: z.array(
    responseObject({
      theme: z.string(),
      attribute: perceptionAttributeSchema,
      polarity: perceptionPolaritySchema,
      quote: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    }),
  ),
});

export type PerceptionResponse = z.infer<typeof perceptionResponseSchema>;
export type PerceptionQuote = z.infer<typeof perceptionQuoteSchema>;
export type PerceptionAttribute = z.infer<typeof perceptionAttributeSchema>;
export type PerceptionScore = z.infer<typeof perceptionScoreSchema>;
export type PerceptionCoverage = z.infer<typeof perceptionCoverageSchema>;
export type ExecutionPerception = z.infer<typeof executionPerceptionSchema>;
