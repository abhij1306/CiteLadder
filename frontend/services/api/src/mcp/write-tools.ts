/**
 * MCP changes, listed and callable only by a grant holding `citeladder:write`.
 * Small edits run directly; larger ones are prepared (validated by a dry run
 * of their command) and run only through `confirm_change` after the user
 * agreed. The member's live role decides every change; the in-app Agent never
 * sees this catalogue.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { logicalEngineSchema } from '@citeladder/contracts/providers';
import { promptCohortSchema } from '@citeladder/contracts/project';
import { requireCapability, type Actor } from '../auth/actor.ts';
import { recordSecurityEvent, type McpWriteKind } from '../auth/security-events.ts';
import { scheduleCreate } from '../audits/schedule-inputs.ts';
import { declareAction, setActionStatus } from '../commands/actions.ts';
import { cancelAudit, launchAudit } from '../commands/audits.ts';
import { addCompetitor, removeCompetitor } from '../commands/competitors.ts';
import { auditRuntime } from '../audits/config.ts';
import { estimateAudit } from '../audits/estimate.ts';
import { marketIdList } from '../audits/inputs.ts';
import {
  createPrompts,
  createTopic,
  deleteTopic,
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
const project = {
  project_id: uuid.describe('A project id that list_projects returned.'),
};
const promptSet = uuid
  .describe(
    'A prompt set id from read_prompt_portfolio; omit when the project has only one prompt set.',
  )
  .nullish();
const engines = z
  .array(logicalEngineSchema)
  .min(1)
  .describe('The AI engines to ask; at least one.');
const repetitions = z
  .int()
  .min(policy.projects.min_repetitions)
  .max(policy.projects.max_repetitions)
  .describe('How many times each prompt is asked per engine; omit for the project default.')
  .nullish();
const markets = marketIdList
  .describe(
    'Market ids from get_project_business_context; null is the default market. Omit for the default market only.',
  )
  .nullish();
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

/** A project's topic or competitor by its name, which is unique ignoring case. */
async function requireNamed(
  db: Database,
  kind: 'topic' | 'competitor',
  name: string,
  projectId: string,
) {
  const row = await db
    .selectFrom(kind === 'topic' ? 'topics' : 'competitors')
    .select(['id', 'name'])
    .where('project_id', '=', projectId)
    .where(sql`lower(${sql.ref('name')})`, '=', name.toLowerCase())
    .executeTakeFirst();
  if (!row) throw new McpInputError(`No ${kind} named "${name}" was found in this project`);
  return row;
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
    description:
      'Add a topic, a named group of tracked prompts (for example "Pricing" or "Integrations") that visibility is broken down by. Runs at once and returns the topic id; pass it as topic_id to prepare_add_prompts to file new prompts under it. Topic names are unique in a project, ignoring case.',
    schema: z.strictObject({
      ...project,
      name: topicCreate.shape.name.describe('The topic name, unique in the project.'),
      description: z
        .string()
        .max(1024)
        .describe('What prompts under this topic ask about; optional.')
        .nullish(),
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
    description:
      'Rename one topic, after the user agrees. Its prompts and past results stay under it, so prefer this to delete_topic and create_topic when only the name is wrong. Runs at once and returns the new name; refused if another topic in the project already has the name, or if topic_id is not in this project.',
    schema: z.strictObject({
      ...project,
      topic_id: uuid.describe('A topic id from read_prompt_portfolio topics or create_topic.'),
      name: topicCreate.shape.name.describe('The new name, unique in the project.'),
    }),
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
      "Replace the wording of one tracked prompt, after the user agrees, such as to fix a typo or make it read like a buyer's question. Runs at once and returns the new wording; earlier measurements keep the old wording, so results before and after the edit may not compare. To stop measuring a prompt use prepare_archive_prompts, and to add new ones prepare_add_prompts. Refused if prompt_id is not in this project.",
    schema: z.strictObject({
      ...project,
      prompt_id: uuid.describe('A prompt id from read_prompt_portfolio.'),
      text: promptInput.shape.text.describe(
        'The new wording: a short question a buyer would ask an AI assistant.',
      ),
    }),
    annotations: hints(false, true),
    run: async (trx, actor, args) => {
      await requireInProject(trx, 'prompt', args.prompt_id, args.project_id);
      const prompt = await updatePrompt(trx, actor, args.prompt_id, { text: args.text });
      return { summary: `The prompt now reads "${prompt.text}".` };
    },
  }),
  add_competitor: direct('add_competitor', {
    title: 'Add a competitor',
    description:
      'Track one more competitor, so visibility reads rank its mentions and citations in AI answers beside your brand. Runs at once; refused if the project already tracks that name or has reached its competitor limit. get_project_business_context lists the competitors tracked now.',
    schema: competitorCreate.extend({
      ...project,
      name: competitorCreate.shape.name.describe('The brand name as buyers write it.'),
      aliases: competitorCreate.shape.aliases.describe(
        'Other names AI answers use for the brand, such as a short form or old name.',
      ),
      domains: competitorCreate.shape.domains.describe(
        "The brand's own domains, such as example.com, so its cited pages are attributed to it.",
      ),
    }),
    annotations: hints(false, false),
    run: async (trx, actor, { project_id: projectId, ...input }) => {
      const competitor = await addCompetitor(trx, actor, projectId, input);
      return { summary: `Now tracking ${competitor.name}.`, competitor: { id: competitor.id } };
    },
  }),
  remove_competitor: direct('remove_competitor', {
    title: 'Stop tracking a competitor',
    description:
      'Stop tracking one competitor by name, as get_project_business_context lists it, so visibility reads no longer rank it. Recorded answers are kept. Runs at once and cannot be undone; add_competitor tracks it again but its aliases and domains must be given again.',
    schema: z.strictObject({
      ...project,
      name: competitorCreate.shape.name.describe('The tracked competitor name, ignoring case.'),
    }),
    annotations: hints(true, false),
    run: async (trx, actor, args) => {
      const competitor = await requireNamed(trx, 'competitor', args.name, args.project_id);
      await removeCompetitor(trx, actor, args.project_id, competitor.id);
      return { summary: `Stopped tracking ${competitor.name}.` };
    },
  }),
  update_action_status: direct('update_action_status', {
    title: 'Update an Action status',
    description:
      'Dismiss one Action the user does not want to act on, or reopen a dismissed one. Runs at once. To record that the work was done, use prepare_declare_implemented instead.',
    schema: z.strictObject({
      ...project,
      action_id: uuid.describe('An Action id from read_actions.'),
      status: z
        .enum(policy.opportunity.actions.ACTION_USER_STATUSES)
        .describe('dismissed hides the Action from the open list; open restores it.'),
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
      'Stop a queued or running audit, after the user agrees, such as one launched by mistake or on the wrong engines. Runs at once and cannot be undone; answers recorded so far are kept, and no further answers are collected for it. To launch a corrected audit use prepare_launch_audit. Refused if the audit is not in this project or has already finished.',
    schema: z.strictObject({
      ...project,
      audit_id: uuid.describe(
        'A queued or running audit id (audit_id) that read_visibility_overview or confirm_change returned.',
      ),
    }),
    annotations: hints(true, false),
    run: async (trx, actor, args) => {
      await requireInProject(trx, 'audit', args.audit_id, args.project_id);
      await cancelAudit(trx, actor, args.audit_id);
      return { summary: 'The audit was cancelled.' };
    },
  }),
  delete_topic: direct('delete_topic', {
    title: 'Delete a topic',
    description:
      'Delete one topic by name, after the user agrees, when the grouping itself is no longer wanted. Its prompts are kept, still tracked, without a topic, and its subtopics become top-level; recorded answers are kept. Runs at once and cannot be undone. To fix only the name use rename_topic; to stop measuring the prompts use prepare_archive_prompts.',
    schema: z.strictObject({
      ...project,
      name: topicCreate.shape.name.describe('The topic name, ignoring case.'),
    }),
    annotations: hints(true, false),
    run: async (trx, actor, args) => {
      const topic = await requireNamed(trx, 'topic', args.name, args.project_id);
      await deleteTopic(trx, actor, topic.id);
      return {
        summary: `Deleted the topic "${topic.name}"; its prompts are kept without a topic.`,
      };
    },
  }),
  prepare_add_prompts: tool({
    title: 'Prepare to add prompts',
    description:
      'Preview adding 1–50 prompts to a prompt set: which can be added, and which are dropped and why. Nothing changes until the user agrees and you call confirm_change; confirmed prompts are measured from the next audit.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: promptSet,
      prompts: z
        .array(
          z.strictObject({
            text: promptInput.shape.text.describe(
              'A short question a buyer would ask an AI assistant, answerable by naming a business.',
            ),
            topic_id: uuid
              .describe(
                'A topic id from read_prompt_portfolio topics or create_topic; omit for none.',
              )
              .nullish(),
            intent: z
              .string()
              .max(policy.prompts.intent_max_chars)
              .describe('What the buyer is trying to do, in a few words; optional.')
              .nullish(),
            cohort: promptCohortSchema
              .describe(
                'core prompts are scored (the default); comparison prompts name competitors and are reported separately.',
              )
              .nullish(),
          }),
        )
        .min(1)
        .max(policy.prompts.create_batch_max)
        .describe('The prompts to add, each a short buyer question.'),
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
    schema: z.strictObject({
      ...project,
      prompt_ids: z.array(uuid).min(1).max(200).describe('Prompt ids from read_prompt_portfolio.'),
    }),
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
      prompt_set_id: promptSet,
      prompt_ids: z
        .array(uuid)
        .max(500)
        .describe(
          'Prompt ids from read_prompt_portfolio to audit only those; omit for every active prompt in the set.',
        )
        .nullish(),
      engines,
      repetitions,
      market_ids: markets,
      max_attempts: z
        .int()
        .min(1)
        .describe(
          'The most provider attempts the user accepts; omit to use the estimate. The launch is refused if it needs more.',
        )
        .nullish(),
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
      prompt_set_id: promptSet,
      cadence: scheduleCreate.shape.cadence.describe('How often the audit runs.'),
      engines,
      timezone: z
        .string()
        .max(64)
        .describe('An IANA timezone such as Europe/London; omit for the default.')
        .nullish(),
      repetitions,
      interval_minutes: z
        .int()
        .positive()
        .describe('Minutes between runs; only for cadence every_n_minutes.')
        .nullish(),
      next_run_at: z.iso
        .datetime({ offset: true })
        .describe('When the first run starts; omit to start right away.')
        .nullish(),
      market_ids: markets,
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
      action_id: uuid.describe('An open Action id from read_actions.'),
      declared_implemented_at: z.iso
        .datetime({ offset: true })
        .describe('When the work went live; omit for now. Evidence after it is checked.')
        .nullish(),
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
    schema: z.strictObject({
      confirmation_token: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .describe('The confirmation_token the prepare tool returned, exactly as given.'),
    }),
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
