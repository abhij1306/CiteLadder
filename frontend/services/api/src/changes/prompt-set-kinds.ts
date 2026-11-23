import { sql } from 'kysely';
import { z } from 'zod';
import { policy } from '../config.ts';
import {
  deletePrompts,
  deleteTopic,
  PROMPTS_RUN,
  PROMPTS_WRITE,
  reviewCandidates,
  startGeneration,
} from '../commands/prompts.ts';
import { promptBulkDelete } from '../prompts/bulk.ts';
import { candidateReview } from '../prompts/candidates.ts';
import { generationPreconditions } from '../prompts/generation.ts';
import {
  draftCallLimit,
  generationInput,
  validateSelection,
  wantedTopics,
  type GenerationInput,
} from '../prompts/generation-input.ts';
import {
  createPromptSet,
  deletePromptSet,
  promptSetCreate,
  promptSetUpdate,
  scopedPromptSet,
  updatePromptSet,
} from '../prompts/prompt-sets.ts';
import { scopedPrompts } from '../prompts/prompts.ts';
import { listTopics } from '../prompts/topics.ts';
import {
  changeKind,
  countOf,
  MEMBER_WRITE,
  PERMANENT,
  plural,
  ROW_COUNT,
  rowsOf,
  type PreviewContext,
} from './kind.ts';
import { promptSetName, promptsUnder } from './prompt-kinds.ts';

const scopeOf = ({ workspaceId, projectId }: PreviewContext) => ({ workspaceId, projectId });

async function projectSet(context: PreviewContext, setId: string) {
  return scopedPromptSet(context.db, context.workspaceId, setId, context.projectId);
}

function setCounts(context: PreviewContext, setId: string) {
  const { db, workspaceId } = context;
  return Promise.all([
    countOf(
      db
        .selectFrom('prompts')
        .select(ROW_COUNT)
        .where('prompt_set_id', '=', setId)
        .executeTakeFirst(),
    ),
    countOf(
      db
        .selectFrom('prompt_candidates')
        .select(ROW_COUNT)
        .where('workspace_id', '=', workspaceId)
        .where('prompt_set_id', '=', setId)
        .where('disposition', '=', policy.prompts.candidate.pending)
        .executeTakeFirst(),
    ),
    countOf(
      db
        .selectFrom('audit_schedules')
        .select(ROW_COUNT)
        .where('workspace_id', '=', workspaceId)
        .where('prompt_set_id', '=', setId)
        .executeTakeFirst(),
    ),
  ]);
}

function cohortLabel(request: GenerationInput) {
  if (request.mode === 'brand') return 'brand prompts';
  return request.distribution ? 'mixed' : request.cohort;
}

export const promptSetKinds = {
  create_prompt_set: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'create an empty prompt set in the project',
    payload: promptSetCreate.omit({ project_id: true }),
    async execute(trx, _config, actor, change, payload) {
      const set = await createPromptSet(trx, actor.workspaceId, {
        ...payload,
        project_id: change.projectId,
      });
      return { summary: `Created the prompt set "${set.name}".`, prompt_set: { id: set.id } };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Create a prompt set',
        rows: [
          { label: 'Name', value: payload.name },
          ...rowsOf('Description', payload.description ? [payload.description] : []),
        ],
        spend: null,
        opens: { label: 'Open Prompts', path: '/prompts' },
      });
    },
  }),
  rename_prompt_set: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'rename a prompt set or change its description (read_prompt_portfolio view sets)',
    payload: z.strictObject({ prompt_set_id: z.uuid(), ...promptSetUpdate.shape }),
    async execute(trx, _config, actor, change, { prompt_set_id: setId, ...update }) {
      await scopedPromptSet(trx, actor.workspaceId, setId, change.projectId);
      const set = await updatePromptSet(trx, actor.workspaceId, setId, update);
      return { summary: `The prompt set is now "${set.name}".` };
    },
    async preview(context, payload) {
      return {
        title: 'Update a prompt set',
        rows: [
          { label: 'Now', value: await promptSetName(context, payload.prompt_set_id) },
          ...rowsOf('Name', payload.name ? [payload.name] : []),
          ...rowsOf('Description', payload.description ? [payload.description] : []),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  delete_prompt_set: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'delete a prompt set with its prompts, pending suggestions and audit schedules; earlier answers stay (read_prompt_portfolio view sets)',
    payload: z.strictObject({ prompt_set_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      await scopedPromptSet(trx, actor.workspaceId, payload.prompt_set_id, change.projectId);
      await deletePromptSet(trx, actor.workspaceId, payload.prompt_set_id);
      return { summary: 'Deleted the prompt set.' };
    },
    async preview(context, payload) {
      const set = await projectSet(context, payload.prompt_set_id);
      const [prompts, pending, schedules] = await setCounts(context, set.id);
      return {
        title: 'Delete a prompt set',
        rows: [
          { label: 'Prompt set', value: set.name },
          { label: 'Prompts deleted', value: String(prompts) },
          { label: 'Suggestions deleted', value: String(pending) },
          { label: 'Audit schedules deleted', value: String(schedules) },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  delete_prompts: changeKind({
    permission: PROMPTS_WRITE,
    purpose:
      'delete tracked prompts for good; their earlier answers stay in history without the prompt',
    payload: promptBulkDelete,
    async execute(trx, _config, actor, change, payload) {
      const { count } = await deletePrompts(trx, actor, change.projectId, payload);
      return { summary: `Deleted ${plural(count, 'prompt')}.` };
    },
    async preview(context, payload) {
      const rows = await scopedPrompts(context.db, scopeOf(context), payload.prompt_ids);
      const audited = await countOf(
        context.db
          .selectFrom('audit_prompt_snapshots')
          .select(sql<string>`count(distinct audit_id)`.as('count'))
          .where('workspace_id', '=', context.workspaceId)
          .where('prompt_id', 'in', payload.prompt_ids)
          .executeTakeFirst(),
      );
      return {
        title: `Delete ${plural(rows.length, 'prompt')}`,
        rows: [
          ...rowsOf(
            'Prompt',
            rows.map((row) => row.text),
          ),
          { label: 'Audits that asked them', value: `${audited}, kept in history` },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  review_prompt_candidates: changeKind({
    permission: PROMPTS_WRITE,
    purpose:
      'track (accept_ids) or reject (reject_ids) suggested prompts waiting for review (read_prompt_portfolio view candidates)',
    payload: z.strictObject({ prompt_set_id: z.uuid(), ...candidateReview.shape }),
    async execute(trx, _config, actor, change, { prompt_set_id: setId, ...review }) {
      const reviewed = await reviewCandidates(trx, actor, change.projectId, setId, review);
      return {
        summary: `Tracked ${plural(reviewed.accepted.length, 'prompt')} and rejected ${reviewed.rejected_count}.`,
      };
    },
    async preview(context, payload) {
      const ids = [...payload.accept_ids, ...payload.reject_ids];
      const found = ids.length
        ? await context.db
            .selectFrom('prompt_candidates')
            .select(['id', 'text'])
            .where('workspace_id', '=', context.workspaceId)
            .where('prompt_set_id', '=', payload.prompt_set_id)
            .where('id', 'in', ids)
            .execute()
        : [];
      const text = new Map(found.map((row) => [row.id, row.text]));
      const texts = (list: readonly string[]) => list.flatMap((id) => text.get(id) ?? []);
      return {
        title: `Review ${plural(ids.length, 'suggested prompt')}`,
        rows: [
          ...rowsOf('Track', texts(payload.accept_ids)),
          ...rowsOf('Reject', texts(payload.reject_ids)),
        ],
        spend: null,
        opens: { label: 'Open Prompts', path: '/prompts' },
      };
    },
  }),
  generate_prompts: changeKind({
    permission: PROMPTS_RUN,
    purpose:
      'have CiteLadder suggest new prompts for a prompt set; mode brand suggests prompts that ask about the brand directly. Spends AI credits when confirmed, and the suggestions wait for review',
    payload: z.strictObject({ prompt_set_id: z.uuid(), request: generationInput }),
    async live(trx, _config, actor, change, payload) {
      await scopedPromptSet(trx, actor.workspaceId, payload.prompt_set_id, change.projectId);
      const topics = await listTopics(trx, {
        workspaceId: actor.workspaceId,
        projectId: change.projectId,
      });
      validateSelection(payload.request, topics);
      await generationPreconditions(trx, actor.workspaceId, payload.prompt_set_id, payload.request);
    },
    async execute(db, _config, actor, change, payload) {
      const result = await startGeneration(
        db,
        actor,
        change.projectId,
        payload.prompt_set_id,
        payload.request,
        { idempotencyKey: change.id },
      );
      const topics = new Map(result.topics.map((topic) => [topic.id, topic.name]));
      return {
        summary: `Suggested ${plural(result.candidates.length, 'prompt')} for review.`,
        requested_count: result.requested_count,
        suggestions: result.candidates.map((candidate) => ({
          text: candidate.text,
          topic: candidate.topic_id ? (topics.get(candidate.topic_id) ?? null) : null,
          cohort: candidate.cohort,
        })),
        admission_drops: result.admission_drops,
        quality_rejected: result.quality_rejected,
        shortfall_reason: result.shortfall_reason,
      };
    },
    async preview(context, payload) {
      const { request } = payload;
      const [setName, topics] = await Promise.all([
        promptSetName(context, payload.prompt_set_id),
        listTopics(context.db, scopeOf(context)),
      ]);
      const wanted = new Set(wantedTopics(request));
      const named = topics.filter((topic) => wanted.has(topic.id)).map((topic) => topic.name);
      return {
        title: `Suggest ${plural(request.count, 'prompt')}`,
        rows: [
          { label: 'Prompt set', value: setName },
          { label: 'Cohort', value: cohortLabel(request) },
          ...(named.length
            ? rowsOf('Topic', named)
            : [{ label: 'Topics', value: `All ${plural(topics.length, 'topic')}` }]),
        ],
        spend: `AI credits for up to ${plural(draftCallLimit(request) + policy.prompts.generation.map_calls, 'model call')}`,
        opens: { label: 'Open Prompts', path: '/prompts' },
      };
    },
  }),
  delete_topic: changeKind({
    permission: PROMPTS_WRITE,
    purpose: 'delete a topic; its prompts stay tracked without a topic',
    payload: z.strictObject({ topic_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      await deleteTopic(trx, actor, change.projectId, payload.topic_id);
      return { summary: 'Deleted the topic.' };
    },
    async preview(context, payload) {
      const topic = (await listTopics(context.db, scopeOf(context))).find(
        (row) => row.id === payload.topic_id,
      );
      const prompts = await promptsUnder(context, [payload.topic_id]);
      return {
        title: 'Delete a topic',
        rows: [
          { label: 'Topic', value: topic?.name ?? '' },
          { label: 'Prompts left without a topic', value: String(prompts) },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
