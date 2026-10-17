/**
 * What each confirmed change runs. A prepare tool stores one of these payloads
 * after its command's dry run accepted it; `confirm_change` parses it back and
 * runs the same command for real, inside the confirmation's transaction.
 */
import { z } from 'zod';
import type { Actor } from '../auth/actor.ts';
import { scheduleCreate } from '../audits/schedule-inputs.ts';
import { auditLaunchInput } from '../audits/inputs.ts';
import { declareAction } from '../commands/actions.ts';
import { launchAudit } from '../commands/audits.ts';
import { createPrompts, setPromptStatuses } from '../commands/prompts.ts';
import { createSchedule } from '../commands/schedules.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { promptInput } from '../prompts/prompts.ts';
import { declarationCreate } from '../routes/action-contracts.ts';
import type { Change, ConfirmedKind } from './confirmations.ts';
import type { Evidence } from './types.ts';

export const payloads = {
  add_prompts: z.strictObject({ prompt_set_id: z.uuid(), prompts: z.array(promptInput).min(1) }),
  archive_prompts: z.strictObject({
    groups: z.array(z.strictObject({ prompt_set_id: z.uuid(), prompt_ids: z.array(z.uuid()) })),
  }),
  launch_audit: z.strictObject({ project_id: z.uuid(), request: auditLaunchInput }),
  schedule: z.strictObject({ project_id: z.uuid(), schedule: scheduleCreate }),
  declare_implemented: z.strictObject({ action_id: z.uuid(), declaration: declarationCreate }),
} satisfies Record<ConfirmedKind, z.ZodType>;

/** The idempotency key a declaration confirmed through MCP records. */
export const declarationKey = (confirmationId: string) => `mcp:${confirmationId}`;

type Run = (
  trx: Database,
  config: ServiceConfig,
  actor: Actor,
  change: Change,
) => Promise<Evidence>;

const runs: Record<ConfirmedKind, Run> = {
  add_prompts: async (trx, _config, actor, change) => {
    const payload = payloads.add_prompts.parse(change.payload);
    const created = await createPrompts(trx, actor, payload.prompt_set_id, payload.prompts);
    return {
      summary: `Added ${created.length} active prompt(s).`,
      prompts: created.map((prompt) => ({ id: prompt.id, text: prompt.text })),
    };
  },
  archive_prompts: async (trx, _config, actor, change) => {
    const payload = payloads.archive_prompts.parse(change.payload);
    for (const group of payload.groups)
      await setPromptStatuses(trx, actor, group.prompt_set_id, {
        prompt_ids: group.prompt_ids,
        status: 'archived',
      });
    const count = payload.groups.reduce((total, group) => total + group.prompt_ids.length, 0);
    return { summary: `Archived ${count} prompt(s).` };
  },
  launch_audit: async (trx, config, actor, change) => {
    const payload = payloads.launch_audit.parse(change.payload);
    const audits = await launchAudit(trx, config, actor, payload.project_id, payload.request);
    const launched = audits.length === 1 ? 'the audit' : `${audits.length} audits, one per market`;
    return {
      summary: `Launched ${launched}. Queued; runs start shortly.`,
      audits: audits.map((audit) => ({ id: audit.id, status: audit.status, market: audit.market })),
    };
  },
  schedule: async (trx, _config, actor, change) => {
    const payload = payloads.schedule.parse(change.payload);
    const schedule = await createSchedule(trx, actor, payload.project_id, payload.schedule);
    return {
      summary: `Created a ${schedule.cadence} audit schedule.`,
      schedule: { id: schedule.id, next_run_at: schedule.next_run_at },
    };
  },
  declare_implemented: async (trx, _config, actor, change) => {
    const payload = payloads.declare_implemented.parse(change.payload);
    const { declaration } = await declareAction(
      trx,
      actor,
      payload.action_id,
      payload.declaration,
      { idempotencyKey: declarationKey(change.id) },
    );
    return {
      summary: 'Action declared implemented. CiteLadder checks later evidence against it.',
      declaration: { id: declaration.id },
    };
  },
};

export function runConfirmed(trx: Database, config: ServiceConfig, actor: Actor, change: Change) {
  return runs[change.kind](trx, config, actor, change);
}
