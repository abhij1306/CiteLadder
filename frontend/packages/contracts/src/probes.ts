import { z } from 'zod';

import { auditScheduleCadenceSchema, citationClassificationSchema } from './audits.ts';
import { credentialModeSchema } from './billing.ts';
import { auditMarketSchema } from './markets.ts';
import { logicalEngineSchema } from './providers.ts';
import { pageStandingSchema } from './visibility-evidence.ts';

const uuid = () => z.uuid();
const score = z.int().min(0).max(100);

export const objectionGroupRequestSchema = z.object({ name: z.string() });
export const objectionGroupMergeRequestSchema = z.object({ into_id: uuid() });
export const objectionGroupSchema = z.object({ id: uuid(), name: z.string() });

export const probeRunRequestSchema = z.object({ fingerprint: z.string().min(1) });
export type ProbeRunRequest = z.infer<typeof probeRunRequestSchema>;

export const probeScheduleRequestSchema = z.union([
  z.object({ cadence: z.null() }),
  z.object({ cadence: z.enum(['daily', 'weekly']), fingerprint: z.string().min(1) }),
]);
export type ProbeScheduleRequest = z.infer<typeof probeScheduleRequestSchema>;

const probeQuoteSchema = z.object({
  credential_mode: credentialModeSchema,
  engines: z.array(logicalEngineSchema),
  blocked: z.enum(['trial', 'no_key', 'no_market', 'task_limit']).nullable(),
  markets: z.array(auditMarketSchema),
  questions: z.int().nonnegative(),
  repetitions: z.int().positive(),
  answers: z.int().nonnegative(),
  credits: z.int().nonnegative(),
  balance: z.int().nullable(),
  fingerprint: z.string(),
});
export type ProbeQuote = z.infer<typeof probeQuoteSchema>;

const probeStateSchema = z.enum(['running', 'labelling', 'ready', 'failed', 'unavailable']);

const probeRunSchema = z.object({
  launch_id: uuid(),
  state: probeStateSchema,
  created_at: z.string(),
  engines: z.array(logicalEngineSchema),
  markets: z.array(auditMarketSchema),
  answers: z.int().nonnegative(),
});
export type ProbeRun = z.infer<typeof probeRunSchema>;

export const probeStatusSchema = z.object({
  quote: probeQuoteSchema,
  latest: probeRunSchema.nullable(),
  schedule: z
    .object({
      id: uuid(),
      cadence: auditScheduleCadenceSchema,
      enabled: z.boolean(),
      next_run_at: z.string().nullable(),
    })
    .nullable(),
});
export type ProbeStatus = z.infer<typeof probeStatusSchema>;

const probeBasisSchema = probeRunSchema.omit({ state: true });

const entitySchema = z.object({
  kind: z.enum(['brand', 'competitor']),
  id: uuid().nullable(),
  name: z.string(),
});

const scoredEntitySchema = entitySchema.extend({ score, named: z.boolean() });

export const probeMarketSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({
    state: z.literal('value'),
    probe: probeBasisSchema,
    brand: z.string(),
    category: z.string(),
    language_code: z.string(),
    known_for_answers: z.int().nonnegative(),
    known_for: z.array(z.object({ theme_id: uuid().nullable(), theme: z.string(), score })),
    themes: z.array(
      z.object({
        theme_id: uuid(),
        theme: z.string(),
        entities: z.array(scoredEntitySchema),
        rank: z.int().positive(),
        of: z.int().positive(),
        leader: scoredEntitySchema,
        gap: z.int().nonnegative(),
      }),
    ),
    engines: z.array(
      z.object({
        engine: logicalEngineSchema,
        answered: z.boolean(),
        top_themes: z.array(z.object({ theme_id: uuid().nullable(), theme: z.string() })),
        rank_in_top_theme: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('rank'), rank: z.int().positive() }),
          z.object({ kind: z.literal('not_named') }),
          z.object({ kind: z.literal('not_asked') }),
          z.object({ kind: z.literal('no_theme') }),
        ]),
      }),
    ),
  }),
]);
export type ProbeMarket = z.infer<typeof probeMarketSchema>;
export type ProbeMarketValue = Extract<ProbeMarket, { state: 'value' }>;

export const probeObjectionsSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({
    state: z.literal('value'),
    probe: probeBasisSchema,
    brand: z.string(),
    answers: z.int().nonnegative(),
    answered_by: z.array(logicalEngineSchema),
    average: score.nullable(),
    groups: z.array(
      z.object({
        id: uuid(),
        name: z.string(),
        score: score.nullable(),
        engines: z.array(logicalEngineSchema),
        history: z.array(score.nullable()),
        sources: z.int().nonnegative().nullable(),
        pages: z.array(
          z.object({
            url: z.string(),
            title: z.string(),
            domain: z.string(),
            classification: citationClassificationSchema,
            page_format: z.string().nullable(),
            standing: pageStandingSchema.nullable(),
            citations: z.int().positive(),
          }),
        ),
      }),
    ),
  }),
]);
export type ProbeObjections = z.infer<typeof probeObjectionsSchema>;
export type ProbeObjectionsValue = Extract<ProbeObjections, { state: 'value' }>;
