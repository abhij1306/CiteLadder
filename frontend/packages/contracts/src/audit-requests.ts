/**
 * Request bodies of runs: launch, estimate, repair and schedules. These own
 * the wire shape; the API `.extend`s each with its configured bounds
 * (repetitions, markets per launch, selectable engines, timezones), and the
 * browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import { auditScheduleCadenceSchema } from './audits.ts';
import { benchmarkModeSchema } from './project.ts';
import { logicalEngineSchema } from './providers.ts';

const uuid = () => z.uuid();

/** A launch's markets: `null` is the project's default market. */
const marketIds = z.array(uuid().nullable()).min(1);
const auditScopeSchema = z.enum(['brand', 'commerce']);

/**
 * `POST /audits/estimate`: the prompts measured (a whole `prompt_set_id`, or
 * explicit `prompt_ids`) across one or more logical engines, one run per
 * market. The workspace comes from the `X-Workspace-Id` header and funding
 * from its plan, never the body.
 */
export const auditEstimateRequestSchema = z.object({
  project_id: uuid(),
  prompt_set_id: uuid().nullish(),
  prompt_ids: z.array(uuid()).default([]),
  engines: z.array(logicalEngineSchema).min(1),
  repetitions: z.number().int().nullish(),
  market_ids: marketIds.default([null]),
});
export type AuditEstimateRequest = z.input<typeof auditEstimateRequestSchema>;

/** `POST /audits`: an estimate's selection plus the run's scope and seed. */
export const auditLaunchRequestSchema = auditEstimateRequestSchema.extend({
  benchmark_mode: benchmarkModeSchema.nullish(),
  audit_scope: auditScopeSchema.default('brand'),
  /** Optional 64-bit seed as a decimal string; generated and stored when omitted. */
  random_seed: z.string().nullish(),
});
export type AuditLaunchRequest = z.input<typeof auditLaunchRequestSchema>;

/** A repair of selected failed slots of a finished run. */
export const auditRepairRequestSchema = z.object({
  provider: z.string().nullish(),
  engine: z.string().nullish(),
  prompt_id: uuid().nullish(),
  task_ids: z.array(uuid()).nullish(),
});
export type AuditRepairRequest = z.input<typeof auditRepairRequestSchema>;

/** Every schedule field; a create defaults the optional ones, an update sends any subset. */
export const auditScheduleUpdateRequestSchema = z.object({
  prompt_set_id: uuid(),
  audit_scope: auditScopeSchema,
  cadence: auditScheduleCadenceSchema,
  interval_minutes: z.int().positive().nullable(),
  timezone: z.string().trim().min(1),
  engines: z.array(logicalEngineSchema).min(1),
  market_ids: marketIds,
  repetitions: z.int().nullable(),
  benchmark_mode: benchmarkModeSchema.nullable(),
  enabled: z.boolean(),
  next_run_at: z.iso.datetime({ offset: true }).nullable(),
});

const scheduleFields = auditScheduleUpdateRequestSchema.shape;
const auditScheduleCreateRequestSchema = auditScheduleUpdateRequestSchema.extend({
  audit_scope: scheduleFields.audit_scope.default('brand'),
  interval_minutes: scheduleFields.interval_minutes.default(null),
  timezone: scheduleFields.timezone.optional(),
  market_ids: scheduleFields.market_ids.default([null]),
  repetitions: scheduleFields.repetitions.default(null),
  benchmark_mode: scheduleFields.benchmark_mode.default(null),
  enabled: scheduleFields.enabled.default(true),
  next_run_at: scheduleFields.next_run_at.default(null),
});
export type AuditScheduleCreateRequest = z.input<typeof auditScheduleCreateRequestSchema>;
export type AuditScheduleUpdateRequest = Partial<z.input<typeof auditScheduleUpdateRequestSchema>>;
