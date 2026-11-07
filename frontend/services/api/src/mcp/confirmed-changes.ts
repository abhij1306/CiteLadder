/**
 * The changes an MCP grant prepares and the user then confirms: one entry per
 * kind holding the permission its command needs, the payload stored behind the
 * confirmation token and the one `execute` both steps run. A prepare tool
 * rehearses `execute` in a rolled-back transaction before it stores the
 * payload; `confirm_change` parses the stored payload back and runs the same
 * `execute` for real, inside the confirmation's transaction.
 */
import { z } from 'zod';
import { actionDeclarationRequestSchema } from '@citeladder/contracts/actions';
import type { Actor } from '../auth/actor.ts';
import { scheduleCreate } from '../audits/schedule-inputs.ts';
import { auditLaunchInput } from '../audits/inputs.ts';
import { ACTIONS_WRITE, declareAction } from '../commands/actions.ts';
import { AUDITS_RUN, launchAudit } from '../commands/audits.ts';
import { authorize, type Authorized, type Permission } from '../commands/permission.ts';
import { createPrompts, PROMPTS_WRITE, setPromptStatuses } from '../commands/prompts.ts';
import { createSchedule, SCHEDULES_WRITE } from '../commands/schedules.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { operatorTransaction } from '../db/operator-transaction.ts';
import { promptInput } from '../prompts/prompts.ts';
import type { Evidence } from './types.ts';

/** A prepared change's identity: its confirmation id and the project it was authorized for. */
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
    /**
     * The dry run: `execute` with every check, admission and write it makes,
     * rolled back; owners join this transaction. `inspect` reads the
     * rehearsed state before the rollback. Returns the payload to store.
     */
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
    /** The confirmed run: the member's live role decides, as at prepare time. */
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

/** The idempotency key a declaration confirmed through MCP records. */
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
  archive_prompts: preparedKind({
    permission: PROMPTS_WRITE,
    payload: z.strictObject({
      groups: z.array(z.strictObject({ prompt_set_id: z.uuid(), prompt_ids: z.array(z.uuid()) })),
    }),
    async execute(trx, _config, actor, change, payload) {
      for (const group of payload.groups)
        await /* NOSONAR -- One transaction: groups apply in order. */ setPromptStatuses(
          trx,
          actor,
          change.projectId,
          group.prompt_set_id,
          { prompt_ids: group.prompt_ids, status: 'archived' },
        );
      const count = payload.groups.reduce((total, group) => total + group.prompt_ids.length, 0);
      return { summary: `Archived ${count} prompt(s).` };
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
