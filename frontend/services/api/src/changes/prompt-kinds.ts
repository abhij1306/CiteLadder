import { z } from 'zod';
import { promptStatusSchema } from '@citeladder/contracts/project';
import {
  assignPromptTopic,
  confirmTopics,
  createPrompts,
  createTopic,
  PROMPTS_WRITE,
  setPromptStatuses,
  updatePrompt,
  updateTopic,
} from '../commands/prompts.ts';
import { promptBatch, promptUpdate, scopedPrompts } from '../prompts/prompts.ts';
import { notFound } from '../errors.ts';
import { listTopics, topicConfirm, topicCreate } from '../prompts/topics.ts';
import {
  changeKind,
  countOf,
  PERMANENT,
  plural,
  quoted,
  ROW_COUNT,
  rowsOf,
  type PreviewContext,
} from './kind.ts';

const scopeOf = ({ workspaceId, projectId }: PreviewContext) => ({ workspaceId, projectId });

async function topicNames(context: PreviewContext) {
  const topics = await listTopics(context.db, scopeOf(context));
  return new Map(topics.map((topic) => [topic.id, topic.name]));
}

async function promptTexts(context: PreviewContext, ids: readonly string[]) {
  const rows = await scopedPrompts(context.db, scopeOf(context), ids);
  return rows.map((row) => row.text);
}

async function editedPrompt(context: PreviewContext, promptId: string) {
  const prompt = await context.db
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .select([
      'prompts.text',
      'prompts.intent',
      'prompts.buyer_stage',
      'prompts.persona',
      'prompts.topic_id',
    ])
    .where('prompts.workspace_id', '=', context.workspaceId)
    .where('prompt_sets.project_id', '=', context.projectId)
    .where('prompts.id', '=', promptId)
    .executeTakeFirst();
  if (!prompt) throw notFound('Prompt');
  return prompt;
}

export async function promptSetName(context: PreviewContext, setId: string) {
  const set = await context.db
    .selectFrom('prompt_sets')
    .select('name')
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', '=', setId)
    .executeTakeFirst();
  return set?.name ?? 'the prompt set';
}

const topicName = topicCreate.shape.name;
const shown = (value: unknown) =>
  value === null || value === undefined || value === '' ? 'empty' : String(value);
const promptEdit = z
  .strictObject({
    prompt_id: z.uuid(),
    ...promptUpdate.pick({ text: true, intent: true, buyer_stage: true, persona: true }).shape,
    topic_id: z.uuid().nullable().optional(),
  })
  .refine(
    (edit) => [edit.text, edit.intent, edit.buyer_stage, edit.persona].every((v) => v !== null),
    { message: 'Leave a field out to keep it; only topic_id takes null' },
  )
  .refine(
    ({ prompt_id: _id, ...edit }) => Object.values(edit).some((value) => value !== undefined),
    {
      message: 'An edit changes at least one field',
    },
  );

export function promptsUnder(context: PreviewContext, topicIds: readonly string[]) {
  return countOf(
    context.db
      .selectFrom('prompts')
      .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
      .select(ROW_COUNT)
      .where('prompt_sets.workspace_id', '=', context.workspaceId)
      .where('prompts.topic_id', 'in', topicIds)
      .executeTakeFirst(),
  );
}

export const promptKinds = {
  add_prompts: changeKind({
    permission: PROMPTS_WRITE,
    purpose: 'track new prompts, active at once',
    payload: z.strictObject({ prompt_set_id: z.uuid(), prompts: promptBatch.shape.prompts }),
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
    async preview(context, payload) {
      const topics = await topicNames(context);
      return {
        title: `Add ${plural(payload.prompts.length, 'prompt')}`,
        rows: [
          { label: 'Prompt set', value: await promptSetName(context, payload.prompt_set_id) },
          ...payload.prompts.map((prompt) => {
            const topic = prompt.topic_id ? topics.get(prompt.topic_id) : undefined;
            const notes = [topic && `topic: ${topic}`, prompt.cohort && `cohort: ${prompt.cohort}`];
            const noted = notes.filter(Boolean).join('; ');
            return { label: 'Prompt', value: noted ? `${prompt.text} (${noted})` : prompt.text };
          }),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  update_prompts: changeKind({
    permission: PROMPTS_WRITE,
    purpose:
      'activate or archive tracked prompts (status), or file them under one topic (topic; topic_id null for none)',
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
            await /* NOSONAR */ setPromptStatuses(
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
    async preview(context, payload) {
      switch (payload.kind) {
        case 'status': {
          const texts = await promptTexts(
            context,
            payload.groups.flatMap((group) => group.prompt_ids),
          );
          const verb = payload.status === 'archived' ? 'Archive' : 'Activate';
          return {
            title: `${verb} ${plural(texts.length, 'prompt')}`,
            rows: rowsOf('Prompt', texts),
            spend: null,
            opens: null,
          };
        }
        case 'topic': {
          const texts = await promptTexts(context, payload.prompt_ids);
          const name = payload.topic_id ? (await topicNames(context)).get(payload.topic_id) : null;
          return {
            title: name
              ? `File ${plural(texts.length, 'prompt')} under a topic`
              : `File ${plural(texts.length, 'prompt')} out of every topic`,
            rows: [...(name ? [{ label: 'Topic', value: name }] : []), ...rowsOf('Prompt', texts)],
            spend: null,
            opens: null,
          };
        }
        default: {
          const unhandled: never = payload;
          throw new Error(`Unknown prompt change: ${JSON.stringify(unhandled)}`);
        }
      }
    },
  }),
  update_prompt_text: changeKind({
    permission: PROMPTS_WRITE,
    purpose:
      "edit one tracked prompt's text, intent, buyer stage, persona or topic; earlier results keep the old values",
    payload: promptEdit,
    async execute(trx, _config, actor, change, { prompt_id: promptId, ...edit }) {
      const prompt = await updatePrompt(trx, actor, change.projectId, promptId, edit);
      return { summary: `Updated the prompt "${prompt.text}".` };
    },
    async preview(context, { prompt_id: promptId, ...edit }) {
      const now = await editedPrompt(context, promptId);
      const current: Record<string, unknown> = now;
      const names = await topicNames(context);
      const named = (field: string, value: unknown) =>
        field === 'topic_id'
          ? typeof value === 'string'
            ? (names.get(value) ?? '')
            : 'no topic'
          : value;
      return {
        title: edit.text ? 'Reword a prompt' : 'Edit a prompt',
        rows: [
          ...(edit.text ? [] : [{ label: 'Prompt', value: now.text }]),
          ...Object.entries(edit).map(([field, value]) => ({
            label: field === 'topic_id' ? 'Topic' : field.replaceAll('_', ' '),
            value: `${shown(named(field, current[field]))} → ${shown(named(field, value))}`,
          })),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  create_topic: changeKind({
    permission: PROMPTS_WRITE,
    purpose: 'add a topic, a named group of tracked prompts',
    payload: z.strictObject({ name: topicName, description: z.string().max(1024).default('') }),
    async execute(trx, _config, actor, change, payload) {
      const topic = await createTopic(trx, actor, change.projectId, payload);
      return {
        summary: `Created the topic "${topic.name}".`,
        topic: { id: topic.id, name: topic.name },
      };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Create a topic',
        rows: [
          { label: 'Name', value: payload.name },
          ...rowsOf('Description', payload.description ? [payload.description] : []),
        ],
        spend: null,
        opens: null,
      });
    },
  }),
  rename_topic: changeKind({
    permission: PROMPTS_WRITE,
    purpose: 'rename one topic; its prompts and results stay under it',
    payload: z.strictObject({ topic_id: z.uuid(), name: topicName }),
    async execute(trx, _config, actor, change, payload) {
      const topic = await updateTopic(trx, actor, change.projectId, payload.topic_id, {
        name: payload.name,
      });
      return { summary: `Renamed the topic to "${topic.name}".` };
    },
    async preview(context, payload) {
      const before = (await topicNames(context)).get(payload.topic_id) ?? '';
      return {
        title: 'Rename a topic',
        rows: [
          { label: 'Now', value: before },
          { label: 'After', value: payload.name },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  confirm_topics: changeKind({
    permission: PROMPTS_WRITE,
    purpose:
      "save a topic plan in one change: create, rename and delete topics (a deleted topic's prompts stay tracked without a topic)",
    payload: topicConfirm,
    async execute(trx, _config, actor, change, payload) {
      const topics = await confirmTopics(trx, actor, change.projectId, payload);
      return {
        summary: `Saved the topics. The project now has ${topics.length}: ${quoted(topics.map((topic) => topic.name))}.`,
        topics: topics.map(({ id, name }) => ({ id, name })),
      };
    },
    async preview(context, payload) {
      const names = await topicNames(context);
      const named = (id: string) => names.get(id) ?? '';
      return {
        title: 'Save the topic plan',
        rows: [
          ...rowsOf(
            'Create',
            payload.create.map((topic) => topic.name),
          ),
          ...rowsOf(
            'Rename',
            payload.rename.map((topic) => `${named(topic.id)} → ${topic.name}`),
          ),
          ...rowsOf('Delete', payload.delete.map(named)),
          ...(payload.delete.length
            ? [
                {
                  label: 'Prompts left without a topic',
                  value: String(await promptsUnder(context, payload.delete)),
                },
                PERMANENT,
              ]
            : []),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
