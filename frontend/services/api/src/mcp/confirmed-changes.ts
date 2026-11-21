import { z } from 'zod';
import { actionDeclarationRequestSchema } from '@citeladder/contracts/actions';
import { promptStatusSchema } from '@citeladder/contracts/project';
import type { Actor } from '../auth/actor.ts';
import { scheduleCreate } from '../audits/schedule-inputs.ts';
import { auditLaunchInput } from '../audits/inputs.ts';
import { ACTIONS_WRITE, declareAction } from '../commands/actions.ts';
import { AUDITS_RUN, launchAudit } from '../commands/audits.ts';
import { authorize, type Authorized, type Permission } from '../commands/permission.ts';
import {
  assignPromptTopic,
  createPrompts,
  PROMPTS_WRITE,
  setPromptStatuses,
} from '../commands/prompts.ts';
import { createSchedule, SCHEDULES_WRITE } from '../commands/schedules.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { operatorTransaction } from '../db/operator-transaction.ts';
import { promptInput } from '../prompts/prompts.ts';
import type { Evidence } from './types.ts';

export type PreparedChange = Readonly<{ id: string; projectId: string }>;

type Execute<S extends z.ZodType, P extends Permission> = (
  trx: Database,
  config: ServiceConfig,
  actor: Authorized<P>,
  change: PreparedChange,
  payload: z.output<S>,
) => Promise<Evidence>;

function preparedKind<S extends z.ZodType, P extends Permission>(entry: {
  permission: P;
  payload: S;
  execute: Execute<S, P>;
}) {
  return {
    permission: entry.permission,
    async rehearse<T>(
      db: Database,
      config: ServiceConfig,
      actor: Authorized<P>,
      change: PreparedChange,
      input: z.input<S>,
      inspect: (trx: Database) => Promise<T>,
    ) {
      const payload = entry.payload.parse(input);
      const inspected = await operatorTransaction(db, false, async (trx) => {
        await entry.execute(trx, config, actor, change, payload);
        return inspect(trx);
      });
      return { payload, inspected };
    },
    confirm(
      trx: Database,
      config: ServiceConfig,
      actor: Actor,
      change: PreparedChange,
      stored: unknown,
    ) {
      return entry.execute(
        trx,
        config,
        authorize(actor, entry.permission),
        change,
        entry.payload.parse(stored),
      );
    },
  };
}

const declarationKey = (confirmationId: string) => `mcp:${confirmationId}`;

export const preparedChanges = {
  add_prompts: preparedKind({
    permission: PROMPTS_WRITE,
    payload: z.strictObject({ prompt_set_id: z.uuid(), prompts: z.array(promptInput).min(1) }),
    async execute(trx, _config, actor, change, payload) {
      const created = await createPrompts(
        trx,
        actor,
        change.projectId,
        payload.prompt_set_id,
        payload.prompts,
      );
      return {
        summary: `Added ${created.length} active prompt(s).`,
        prompts: created.map((prompt) => ({ id: prompt.id, text: prompt.text })),
      };
    },
  }),
  update_prompts: preparedKind({
    permission: PROMPTS_WRITE,
    payload: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('status'),
        status: promptStatusSchema,
        groups: z.array(
          z.strictObject({ prompt_set_id: z.uuid(), prompt_ids: z.array(z.uuid()).min(1) }),
        ),
      }),
      z.strictObject({
        kind: z.literal('topic'),
        topic_id: z.uuid().nullable(),
        prompt_ids: z.array(z.uuid()).min(1),
      }),
    ]),
    async execute(trx, _config, actor, change, payload) {
      switch (payload.kind) {
        case 'status': {
          for (const group of payload.groups)
            await /* NOSONAR -- One transaction: groups apply in order. */ setPromptStatuses(
              trx,
              actor,
              change.projectId,
              group.prompt_set_id,
              { prompt_ids: group.prompt_ids, status: payload.status },
            );
          const count = payload.groups.reduce((total, group) => total + group.prompt_ids.length, 0);
          const verb = payload.status === 'archived' ? 'Archived' : 'Activated';
          return { summary: `${verb} ${count} prompt(s).` };
        }
        case 'topic': {
          const { count } = await assignPromptTopic(trx, actor, change.projectId, {
            prompt_ids: payload.prompt_ids,
            topic_id: payload.topic_id,
          });
          const where = payload.topic_id === null ? 'out of every topic' : 'under the topic';
          return { summary: `Filed ${count} prompt(s) ${where}.` };
        }
        default: {
          const unhandled: never = payload;
          throw new Error(`Unknown prompt change: ${JSON.stringify(unhandled)}`);
        }
      }
    },
  }),
  launch_audit: preparedKind({
    permission: AUDITS_RUN,
    payload: z.strictObject({ request: auditLaunchInput }),
    async execute(trx, config, actor, change, payload) {
      const audits = await launchAudit(trx, config, actor, change.projectId, payload.request);
      const launched =
        audits.length === 1 ? 'the audit' : `${audits.length} audits, one per market`;
      return {
        summary: `Launched ${launched}. Queued; runs start shortly.`,
        audits: audits.map((audit) => ({
          id: audit.id,
          status: audit.status,
          market: audit.market,
        })),
      };
    },
  }),
  schedule: preparedKind({
    permission: SCHEDULES_WRITE,
    payload: z.strictObject({ schedule: scheduleCreate }),
    async execute(trx, _config, actor, change, payload) {
      const schedule = await createSchedule(trx, actor, change.projectId, payload.schedule);
      return {
        summary: `Created a ${schedule.cadence} audit schedule.`,
        schedule: { id: schedule.id, next_run_at: schedule.next_run_at },
      };
    },
  }),
  declare_implemented: preparedKind({
    permission: ACTIONS_WRITE,
    payload: z.strictObject({
      action_id: z.uuid(),
      declaration: actionDeclarationRequestSchema,
    }),
    async execute(trx, _config, actor, change, payload) {
      const { declaration } = await declareAction(
        trx,
        actor,
        change.projectId,
        payload.action_id,
        payload.declaration,
        { idempotencyKey: declarationKey(change.id) },
      );
      return {
        summary: 'Action declared implemented. CiteLadder checks later evidence against it.',
        declaration: { id: declaration.id },
      };
    },
  }),
};

export type ConfirmedKind = keyof typeof preparedChanges;

export function isConfirmedKind(kind: string): kind is ConfirmedKind {
  return Object.hasOwn(preparedChanges, kind);
}
