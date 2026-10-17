/**
 * MCP changes, listed and callable only by a grant holding `citeladder:write`.
 * Small edits run directly; larger ones are prepared (validated by a dry run
 * of their command) and run only through `confirm_change` after the user
 * agreed. The member's live role decides every change; the in-app Agent never
 * sees this catalogue.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logicalEngineSchema } from '@citeladder/contracts/providers';
import { promptCohortSchema } from '@citeladder/contracts/project';
import { requireCapability, type Actor } from '../auth/actor.ts';
import { recordSecurityEvent, type McpWriteKind } from '../auth/security-events.ts';
import { scheduleCreate } from '../audits/schedule-inputs.ts';
import { declareAction, setActionStatus } from '../commands/actions.ts';
import { cancelAudit, launchAudit } from '../commands/audits.ts';
import { addCompetitor } from '../commands/competitors.ts';
import { auditRuntime } from '../audits/config.ts';
import { estimateAudit } from '../audits/estimate.ts';
import { marketIdList } from '../audits/inputs.ts';
import {
  createPrompts,
  createTopic,
  setPromptStatuses,
  updatePrompt,
  updateTopic,
} from '../commands/prompts.ts';
import { createSchedule } from '../commands/schedules.ts';
import { configEnvironment, policy, type ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { plainJson } from '../db/json.ts';
import { operatorTransaction } from '../db/operator-transaction.ts';
import { isNonEmpty } from '../lists.ts';
import { competitorCreate } from '../projects/competitors.ts';
import { promptInput, screenPrompts } from '../prompts/prompts.ts';
import { topicCreate } from '../prompts/topics.ts';
import { confirmChange, issueConfirmation } from './confirmations.ts';
import { declarationKey, payloads, runConfirmed } from './confirmed-changes.ts';
import { writeActor } from './data.ts';
import { argumentProblem, inputSchema } from './tools.ts';
import { McpInputError, type Evidence, type McpPrincipal } from './types.ts';

type Context = { db: Database; config: ServiceConfig; principal: McpPrincipal };
type Annotations = {
  readOnlyHint: false;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
};
type Definition<S extends z.ZodObject> = {
  title: string;
  description: string;
  schema: S;
  annotations: Annotations;
  run: (context: Context, args: z.output<S>) => Promise<Evidence>;
};
const tool = <S extends z.ZodObject>(definition: Definition<S>) => definition;
const hints = (destructive: boolean, idempotent: boolean): Annotations => ({
  readOnlyHint: false,
  destructiveHint: destructive,
  idempotentHint: idempotent,
  openWorldHint: false,
});
const uuid = z.uuid();
const project = { project_id: uuid };
/**
 * A prepare's dry run: the real command, with every check, admission and
 * write it makes, rolled back. Owners join this transaction.
 */
const rehearse = <T>(db: Database, run: (trx: Database) => Promise<T>) =>
  operatorTransaction(db, false, run);

/**
 * A single-step change: authorized for the project, run, and recorded in one
 * transaction. `run` returns the user-facing outcome.
 */
function direct<S extends z.ZodObject<{ project_id: typeof uuid }>>(
  kind: McpWriteKind,
  definition: Omit<Definition<S>, 'run'> & {
    run: (trx: Database, actor: Actor, args: z.output<S>) => Promise<Evidence>;
  },
): Definition<S> {
  return {
    ...definition,
    run: ({ db, principal }, args) =>
      db.transaction().execute(async (trx) => {
        const actor = await writeActor(trx, principal, args.project_id);
        const outcome = await definition.run(trx, actor, args);
        await recordSecurityEvent(
          trx,
          `mcp.write.${kind}`,
          principal.userId,
          actor.workspaceId,
          args.project_id,
        );
        return { state: 'changed', change: kind, ...outcome };
      }),
  };
}

type Owned = 'topic' | 'prompt' | 'action' | 'audit';
const ownedTables = { topic: 'topics', action: 'actions', audit: 'audits' } as const;
/** A record named by ID must belong to the project the call authorized. */
async function requireInProject(db: Database, kind: Owned, id: string, projectId: string) {
  const query =
    kind === 'prompt'
      ? db
          .selectFrom('prompts')
          .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
          .select('prompts.id')
          .where('prompts.id', '=', id)
          .where('prompt_sets.project_id', '=', projectId)
      : db
          .selectFrom(ownedTables[kind])
          .select('id')
          .where('id', '=', id)
          .where('project_id', '=', projectId);
  if (!(await query.executeTakeFirst()))
    throw new McpInputError(`The ${kind} was not found in this project`);
}

/** The named prompt set, or the project's only one. */
async function promptSetOf(db: Database, projectId: string, requested: string | null | undefined) {
  const sets = await db
    .selectFrom('prompt_sets')
    .select(['id', 'name'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .execute();
  if (requested) {
    const set = sets.find((item) => item.id === requested);
    if (!set) throw new McpInputError('The prompt set was not found in this project');
    return set;
  }
  const [only, ...others] = sets;
  if (!only) throw new McpInputError('This project has no prompt set yet');
  if (others.length)
    throw new McpInputError(
      `This project has several prompt sets (${sets.map((set) => set.name).join(', ')}); pass prompt_set_id from read_prompt_portfolio`,
    );
  return only;
}

/** A prepared change: what will happen, and the token the user's yes unlocks. */
async function prepared(
  context: Context,
  input: Omit<Parameters<typeof issueConfirmation>[2], 'principal'> & { preview: string },
  details: Evidence = {},
): Promise<Evidence> {
  const { preview, ...change } = input;
  return {
    state: 'needs_confirmation',
    preview,
    instruction:
      'Show this preview to the user. Call confirm_change only after they explicitly agree.',
    ...details,
    ...(await issueConfirmation(context.db, context.config, {
      ...change,
      principal: context.principal,
    })),
  };
}

const quoted = (texts: readonly string[]) => texts.map((text) => `"${text}"`).join(', ');

const writeDefinitions = {
  create_topic: direct('create_topic', {
    title: 'Create a topic',
    description: 'Add a topic to group prompts under. Runs at once.',
    schema: z.strictObject({
      ...project,
      name: topicCreate.shape.name,
      description: z.string().max(1024).nullish(),
    }),
    annotations: hints(false, false),
    run: async (trx, actor, args) => {
      const topic = await createTopic(trx, actor, args.project_id, {
        name: args.name,
        description: args.description ?? '',
      });
      return {
        summary: `Created the topic "${topic.name}".`,
        topic: { id: topic.id, name: topic.name },
      };
    },
  }),
  rename_topic: direct('rename_topic', {
    title: 'Rename a topic',
    description: 'Rename one topic. Runs at once.',
    schema: z.strictObject({ ...project, topic_id: uuid, name: topicCreate.shape.name }),
    annotations: hints(false, true),
    run: async (trx, actor, args) => {
      await requireInProject(trx, 'topic', args.topic_id, args.project_id);
      const topic = await updateTopic(trx, actor, args.topic_id, { name: args.name });
      return { summary: `Renamed the topic to "${topic.name}".` };
    },
  }),
  update_prompt_text: direct('update_prompt_text', {
    title: 'Edit a prompt',
    description:
      'Replace the wording of one tracked prompt. Runs at once; earlier measurements keep the old wording.',
    schema: z.strictObject({ ...project, prompt_id: uuid, text: promptInput.shape.text }),
    annotations: hints(false, true),
    run: async (trx, actor, args) => {
      await requireInProject(trx, 'prompt', args.prompt_id, args.project_id);
      const prompt = await updatePrompt(trx, actor, args.prompt_id, { text: args.text });
      return { summary: `The prompt now reads "${prompt.text}".` };
    },
  }),
  add_competitor: direct('add_competitor', {
    title: 'Add a competitor',
    description: 'Track one more competitor in AI answers. Runs at once.',
    schema: competitorCreate.extend(project),
    annotations: hints(false, false),
    run: async (trx, actor, { project_id: projectId, ...input }) => {
      const competitor = await addCompetitor(trx, actor, projectId, input);
      return { summary: `Now tracking ${competitor.name}.`, competitor: { id: competitor.id } };
    },
  }),
  update_action_status: direct('update_action_status', {
    title: 'Update an Action status',
    description: 'Reopen or dismiss one Action. Runs at once.',
    schema: z.strictObject({
      ...project,
      action_id: uuid,
      status: z.enum(policy.opportunity.actions.ACTION_USER_STATUSES),
    }),
    annotations: hints(false, true),
    run: async (trx, actor, args) => {
      await requireInProject(trx, 'action', args.action_id, args.project_id);
      await setActionStatus(trx, actor, args.action_id, args.status);
      return { summary: `The Action is now ${args.status}.` };
    },
  }),
  cancel_audit: direct('cancel_audit', {
    title: 'Cancel an audit',
    description:
      'Stop a queued or running audit. Runs at once and cannot be undone; results so far are kept.',
    schema: z.strictObject({ ...project, audit_id: uuid }),
    annotations: hints(true, false),
    run: async (trx, actor, args) => {
      await requireInProject(trx, 'audit', args.audit_id, args.project_id);
      await cancelAudit(trx, actor, args.audit_id);
      return { summary: 'The audit was cancelled.' };
    },
  }),
  prepare_add_prompts: tool({
    title: 'Prepare to add prompts',
    description:
      'Preview adding 1–50 prompts to a prompt set: which can be added, and which are dropped and why. Nothing changes until the user agrees and you call confirm_change; confirmed prompts are measured from the next audit.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: uuid.nullish(),
      prompts: z
        .array(
          z.strictObject({
            text: promptInput.shape.text,
            topic_id: uuid.nullish(),
            intent: z.string().max(policy.prompts.intent_max_chars).nullish(),
            cohort: promptCohortSchema.nullish(),
          }),
        )
        .min(1)
        .max(policy.prompts.create_batch_max),
    }),
    annotations: hints(false, false),
    run: async (context, args) => {
      const actor = await writeActor(context.db, context.principal, args.project_id);
      const set = await promptSetOf(context.db, args.project_id, args.prompt_set_id);
      const inputs = args.prompts.map((item) =>
        promptInput.parse({
          text: item.text,
          topic_id: item.topic_id ?? null,
          intent: item.intent ?? '',
          cohort: item.cohort ?? 'core',
        }),
      );
      // Refuse a role that cannot add before showing what would be added.
      requireCapability(actor, 'write');
      const screened = await screenPrompts(context.db, actor.workspaceId, set.id, inputs);
      const dropped = screened.dropped.map(({ text, message }) => ({ text, reason: message }));
      const { admitted } = screened;
      if (!isNonEmpty(admitted))
        return {
          state: 'nothing_to_change',
          preview: 'None of these prompts can be added.',
          dropped,
        };
      await rehearse(context.db, (trx) => createPrompts(trx, actor, set.id, admitted));
      const droppedItems = dropped.map((item) => `"${item.text}" (${item.reason})`).join('; ');
      const lines = [
        `Add ${admitted.length} active prompt(s) to "${set.name}": ${quoted(admitted.map((item) => item.text))}.`,
        dropped.length ? `Dropped: ${droppedItems}.` : '',
      ];
      return prepared(
        context,
        {
          actor,
          projectId: args.project_id,
          kind: 'add_prompts',
          payload: payloads.add_prompts.parse({ prompt_set_id: set.id, prompts: admitted }),
          preview: lines.filter(Boolean).join(' '),
        },
        { dropped },
      );
    },
  }),
  prepare_archive_prompts: tool({
    title: 'Prepare to archive prompts',
    description:
      'Preview archiving tracked prompts so future audits stop measuring them; past results stay. Nothing changes until the user agrees and you call confirm_change.',
    schema: z.strictObject({ ...project, prompt_ids: z.array(uuid).min(1).max(200) }),
    annotations: hints(true, true),
    run: async (context, args) => {
      const actor = await writeActor(context.db, context.principal, args.project_id);
      const ids = [...new Set(args.prompt_ids)];
      const rows = await context.db
        .selectFrom('prompts')
        .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
        .select(['prompts.id', 'prompts.text', 'prompts.status', 'prompts.prompt_set_id'])
        .where('prompts.id', 'in', ids)
        .where('prompt_sets.project_id', '=', args.project_id)
        .execute();
      if (rows.length !== ids.length)
        throw new McpInputError(
          `${ids.length - rows.length} prompt(s) were not found in this project`,
        );
      const active = rows.filter((row) => row.status !== 'archived');
      if (!active.length)
        return { state: 'nothing_to_change', preview: 'These prompts are already archived.' };
      const groups = [...Map.groupBy(active, (row) => row.prompt_set_id)].map(
        ([setId, members]) => ({
          prompt_set_id: setId,
          prompt_ids: members.map((row) => row.id),
        }),
      );
      await rehearse(context.db, async (trx) => {
        for (const group of groups)
          await setPromptStatuses(trx, actor, group.prompt_set_id, {
            ...group,
            status: 'archived',
          });
      });
      const skipped = rows.length - active.length;
      const skippedNote = skipped ? ` ${skipped} already archived.` : '';
      return prepared(context, {
        actor,
        projectId: args.project_id,
        kind: 'archive_prompts',
        payload: { groups },
        preview: `Archive ${active.length} prompt(s): ${quoted(active.map((row) => row.text))}. Future audits stop measuring them; past results stay.${skippedNote}`,
      });
    },
  }),
  prepare_launch_audit: tool({
    title: 'Prepare to launch an audit',
    description:
      'Preview launching an audit of a prompt set (or chosen prompts) on the given engines, with the prompt runs it can spend and its maximum provider attempts. Pass market_ids (from the project context; null is the default market) to run one audit per market. Pass max_attempts to cap the attempts. Nothing runs until the user agrees and you call confirm_change.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: uuid.nullish(),
      prompt_ids: z.array(uuid).max(500).nullish(),
      engines: z.array(logicalEngineSchema).min(1),
      repetitions: z
        .int()
        .min(policy.projects.min_repetitions)
        .max(policy.projects.max_repetitions)
        .nullish(),
      market_ids: marketIdList.nullish(),
      max_attempts: z.int().min(1).nullish(),
    }),
    annotations: hints(false, false),
    run: async (context, args) => {
      const actor = await writeActor(context.db, context.principal, args.project_id);
      const promptIds = args.prompt_ids ?? [];
      const setId = promptIds.length
        ? null
        : (await promptSetOf(context.db, args.project_id, args.prompt_set_id)).id;
      const request = {
        prompt_set_id: setId,
        prompt_ids: promptIds,
        engines: args.engines,
        repetitions: args.repetitions ?? null,
        market_ids: args.market_ids ?? [null],
      };
      const estimate = await estimateAudit(
        context.db,
        actor.workspaceId,
        { ...request, project_id: args.project_id },
        auditRuntime(configEnvironment(context.config)),
      );
      const ceiling = args.max_attempts ?? estimate.maximum_attempt_count;
      const launch = payloads.launch_audit.shape.request.parse({
        ...request,
        max_attempts: ceiling,
      });
      await rehearse(context.db, (trx) =>
        launchAudit(trx, context.config, actor, args.project_id, launch),
      );
      const launched =
        estimate.market_count === 1
          ? 'an audit'
          : `${estimate.market_count} audits, one per market,`;
      return prepared(
        context,
        {
          actor,
          projectId: args.project_id,
          kind: 'launch_audit',
          payload: { project_id: args.project_id, request: launch },
          preview: `Launch ${launched} of ${estimate.prompt_count} prompt(s) on ${args.engines.join(', ')}, ${estimate.repetition_count} repetition(s): ${estimate.execution_count} answers, spending at most ${estimate.execution_count} prompt run(s) in at most ${estimate.maximum_attempt_count} provider attempts (refused if the attempts exceed ${ceiling}).`,
        },
        { maximum_attempt_count: estimate.maximum_attempt_count, max_attempts: ceiling },
      );
    },
  }),
  prepare_schedule: tool({
    title: 'Prepare an audit schedule',
    description:
      'Preview a recurring audit schedule for a prompt set. Pass market_ids (from the project context; null is the default market) to run one audit per market. Each recorded answer spends one prompt run. Nothing changes until the user agrees and you call confirm_change.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: uuid.nullish(),
      cadence: scheduleCreate.shape.cadence,
      engines: z.array(logicalEngineSchema).min(1),
      timezone: z.string().max(64).nullish(),
      repetitions: z
        .int()
        .min(policy.projects.min_repetitions)
        .max(policy.projects.max_repetitions)
        .nullish(),
      interval_minutes: z.int().positive().nullish(),
      next_run_at: z.iso.datetime({ offset: true }).nullish(),
      market_ids: marketIdList.nullish(),
    }),
    annotations: hints(false, false),
    run: async (context, args) => {
      const actor = await writeActor(context.db, context.principal, args.project_id);
      const set = await promptSetOf(context.db, args.project_id, args.prompt_set_id);
      const schedule = scheduleCreate.parse({
        prompt_set_id: set.id,
        cadence: args.cadence,
        engines: args.engines,
        ...(args.timezone ? { timezone: args.timezone } : {}),
        repetitions: args.repetitions ?? null,
        interval_minutes: args.interval_minutes ?? null,
        next_run_at: args.next_run_at ?? null,
        ...(args.market_ids ? { market_ids: args.market_ids } : {}),
      });
      await rehearse(context.db, (trx) => createSchedule(trx, actor, args.project_id, schedule));
      const marketNote =
        schedule.market_ids.length > 1 ? ` in ${schedule.market_ids.length} markets` : '';
      return prepared(context, {
        actor,
        projectId: args.project_id,
        kind: 'schedule',
        payload: { project_id: args.project_id, schedule },
        preview: `Create a ${schedule.cadence.replaceAll('_', ' ')} audit schedule for "${set.name}" on ${schedule.engines.join(', ')}${marketNote} (${schedule.timezone}), first run ${schedule.next_run_at ?? 'right away'}. Each recorded answer spends one prompt run.`,
      });
    },
  }),
  prepare_declare_implemented: tool({
    title: 'Prepare to declare an Action implemented',
    description:
      'Preview declaring that the work of an open Action is done, so CiteLadder checks later evidence against it. Nothing changes until the user agrees and you call confirm_change.',
    schema: z.strictObject({
      ...project,
      action_id: uuid,
      declared_implemented_at: z.iso.datetime({ offset: true }).nullish(),
    }),
    annotations: hints(false, false),
    run: async (context, args) => {
      const actor = await writeActor(context.db, context.principal, args.project_id);
      await requireInProject(context.db, 'action', args.action_id, args.project_id);
      const declaration = payloads.declare_implemented.shape.declaration.parse({
        declared_implemented_at: args.declared_implemented_at ?? new Date().toISOString(),
      });
      const id = randomUUID();
      await rehearse(context.db, (trx) =>
        declareAction(trx, actor, args.action_id, declaration, {
          idempotencyKey: declarationKey(id),
        }),
      );
      const action = await context.db
        .selectFrom('actions')
        .select('target_label')
        .where('id', '=', args.action_id)
        .executeTakeFirstOrThrow();
      return prepared(context, {
        id,
        actor,
        projectId: args.project_id,
        kind: 'declare_implemented',
        payload: { action_id: args.action_id, declaration },
        preview: `Declare the Action "${action.target_label || 'Action'}" implemented as of ${declaration.declared_implemented_at.slice(0, 10)}. CiteLadder then checks later evidence against it.`,
      });
    },
  }),
  confirm_change: tool({
    title: 'Confirm a prepared change',
    description:
      'Make a change a prepare tool previewed. Call only after the user explicitly agreed to that preview in this conversation. A token works once, for ten minutes.',
    schema: z.strictObject({ confirmation_token: z.string().trim().min(1).max(64) }),
    annotations: hints(true, false),
    run: async ({ db, config, principal }, args) => {
      const { kind, result } = await confirmChange(
        db,
        config,
        principal,
        args.confirmation_token,
        (trx, actor, change) => runConfirmed(trx, config, actor, change),
      );
      return { state: 'changed', change: kind, ...result };
    },
  }),
};

type WriteToolName = keyof typeof writeDefinitions;
export const writeTools = Object.entries(writeDefinitions).map(([name, definition]) => ({
  name,
  title: definition.title,
  description: definition.description,
  inputSchema: inputSchema(definition.schema),
  annotations: definition.annotations,
}));
export function isWriteTool(name: string): name is WriteToolName {
  return Object.hasOwn(writeDefinitions, name);
}

const output = z.record(z.string(), z.json());
export async function dispatchWrite(
  context: Context,
  name: WriteToolName,
  input: unknown,
): Promise<Evidence> {
  if (!context.principal.canWrite) throw new McpInputError(`Unknown tool: ${name}`);
  const definition: Definition<z.ZodObject> = writeDefinitions[name];
  const parsed = definition.schema.safeParse(input);
  if (!parsed.success) throw new McpInputError(argumentProblem(parsed.error));
  return output.parse(plainJson(await definition.run(context, parsed.data)));
}
