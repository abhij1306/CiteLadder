import { z } from 'zod';

import { brandMarkFields } from './brand-mark.ts';

import { netSentimentSchema } from './visibility.ts';

const matrixDimensionSchema = z.enum(['engine', 'topic', 'market', 'brand']);
export type MatrixDimension = z.infer<typeof matrixDimensionSchema>;

const answers = z.number().int();

const axesSchema = z.object({
  engine: z.array(z.object({ logical_engine: z.string(), answers })),
  topic: z.array(
    z.object({
      topic_id: z.uuid(),
      name: z.string(),
      renamed_from: z.string().nullable(),
      answers,
    }),
  ),
  market: z.array(z.object({ market_id: z.uuid().nullable(), label: z.string(), answers })),
  brand: z.array(
    z.object({
      name: z.string(),
      is_brand: z.boolean(),
      logo_url: z.string().nullable(),
      website_url: z.string().nullable(),
    }),
  ),
});

const unmeasured = [z.object({ kind: z.literal('not_run') })] as const;
const matrixCellSchema = z.discriminatedUnion('kind', [
  ...unmeasured,
  z.object({
    kind: z.literal('measured'),
    answers,
    mention_rate: z.number().nullable(),
    share_of_voice: z.number().nullable(),
    avg_position: z.number().nullable(),
    win_rate: z.number().nullable(),
    sentiment: netSentimentSchema.nullable(),
  }),
]);
export type MatrixCell = z.infer<typeof matrixCellSchema>;

const grid = z.array(z.array(matrixCellSchema));

const leaderSchema = z.object({
  name: z.string(),
  is_brand: z.boolean(),
  ...brandMarkFields,
  mention_rate: z.number(),
});
const leaders = z.array(
  z.discriminatedUnion('kind', [
    ...unmeasured,
    z.object({ kind: z.literal('measured'), leaders: z.array(leaderSchema) }),
  ]),
);

export const visibilityMatrixSchema = z.object({
  source_audit_ids: z.array(z.uuid()),
  axes: axesSchema,
  grids: z.object({
    engine_topic: grid,
    engine_market: grid,
    engine_brand: grid,
    topic_market: grid,
    topic_brand: grid,
    market_brand: grid,
  }),
  rankings: z.object({ engine: leaders, topic: leaders, market: leaders }),
});

export type VisibilityMatrix = z.infer<typeof visibilityMatrixSchema>;
export type MatrixAxes = VisibilityMatrix['axes'];
export type MatrixPair = keyof VisibilityMatrix['grids'];
