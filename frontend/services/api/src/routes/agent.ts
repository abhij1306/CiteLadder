import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Context } from 'hono';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  agentRequestSchemas,
  agentChatDetailSchema,
  agentChatsPageSchema,
  agentChatCreatedSchema,
  agentTurnAcceptedSchema,
  agentRunSchema,
  agentRevisionsPageSchema,
  agentRevisionSchema,
  agentSkillCatalogSchema,
  agentInstructionsSchema,
  agentTurnEventSchema,
  agentSuggestionsPageSchema,
  agentSuggestionResultSchema,
  agentSuggestionsAppliedSchema,
  agentSuggestionsDismissedSchema,
} from '@citeladder/contracts/agent';
import { listSuggestions } from '../page-documents/suggestion-views.ts';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { readBody } from '../http/body.ts';
import { eventStreamResponse } from '../http/event-stream.ts';
import { agentBindings } from '../agent/bindings.ts';
import { runAgentOnce } from '../agent/worker.ts';
import type { TurnEvents } from '../agent/stream.ts';
import { agentPolicy, AgentError, budgetSchema, type Scope } from '../agent/contracts.ts';
import { interactiveSlots } from '../http/interactive-slots.ts';
import { workspaceChat } from '../agent/messages.ts';
import { changeIdleChat } from '../agent/outputs.ts';
import { chooseOutputTarget } from '../agent/target-adapter.ts';
import { readChat, listChats, listRevisions, runView, revisionView } from '../agent/reads.ts';
import { defineGetRoute, definePostRoute, definePutRoute, defineDeleteRoute } from './define.ts';

const family = 'agent',
  body = agentRequestSchemas(agentPolicy);
// A route under the project path resolves the project in the session read.
const projectFamily = { family, authorize: 'active-project' } as const;
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const chatPath = { chat_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const outputPath = {
  ...chatPath,
  output_id: { scalar: { kind: 'uuid' }, required: true },
} as const;
const revisionPath = {
  ...outputPath,
  revision_id: { scalar: { kind: 'uuid' }, required: true },
} as const;
const suggestionPath = {
  ...outputPath,
  suggestion_id: { scalar: { kind: 'uuid' }, required: true },
} as const;
type SuggestionChange = 'apply' | 'dismiss' | 'revert';
/** `POST …/suggestions/{suggestion_id}/{change}` against the revision the person saw. */
function suggestionRoute(change: SuggestionChange) {
  return definePostRoute({
    family,
    path: `/api/v1/agent/chats/{chat_id}/outputs/{output_id}/suggestions/{suggestion_id}/${change}`,
    capability: 'run',
    params: { path: suggestionPath, query: {} },
    body: body.suggestion,
    response: agentSuggestionResultSchema,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.suggestion),
        value = await chatScope(db, c, path.chat_id),
        { suggestions } = await agentBindings(db);
      const target = {
        chatId: path.chat_id,
        outputId: path.output_id,
        suggestionId: path.suggestion_id,
        baseId: input.base_revision_id,
      };
      return mapped(() => suggestions[change](value, target));
    },
  });
}
const headers = z.object({
  'Idempotency-Key': z.string().max(agentPolicy.idempotency_key_max_chars).nullish(),
});
function key(c: Context<AppEnv>) {
  const value = c.req.header('Idempotency-Key') ?? '';
  if (value.length > agentPolicy.idempotency_key_max_chars)
    throw new ApiError(422, 'Idempotency-Key is too long');
  return value.trim() || randomUUID();
}
function scope(c: Context<AppEnv>, projectId: string): Scope {
  return { workspaceId: c.get('workspace').workspaceId, userId: c.get('user').id, projectId };
}
/**
 * The scope of a chat in the active workspace, which the session read
 * authorized: one chat read names its project. Turns, edits and other writes
 * re-check access inside their own transaction (`agent/access.ts`).
 */
async function chatScope(db: Database, c: Context<AppEnv>, id: string): Promise<Scope> {
  const chat = await workspaceChat(db, c.get('workspace').workspaceId, id);
  return scope(c, chat.project_id);
}
function workspaceOf(c: Context<AppEnv>) {
  return { workspaceId: c.get('workspace').workspaceId };
}
/** An Agent store call with its refusals as HTTP errors; Analyze a page shares it. */
export async function mapped<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof AgentError)) throw error;
    throw agentHttpError(error.code);
  }
}
/** The HTTP error an Agent refusal answers with. */
function agentHttpError(code: string) {
  if (code === 'model_unavailable')
    return new ApiError(503, 'The Agent model is not configured', {
      code: asApiErrorCode('agent_model_unavailable'),
    });
  if (code === 'model_changed')
    return new ApiError(409, 'The Agent model changed', {
      code: asApiErrorCode('model_changed'),
    });
  if (code === 'access_revoked' || code === 'capability_unavailable')
    return new ApiError(403, 'Agent run permission is unavailable');
  if (code === 'agent_context_unavailable') return notFound('Agent context');
  if (code === 'agent_workflow_unavailable') return notFound('Agent workflow');
  if (code === 'agent_page_unavailable')
    return new ApiError(422, 'Choose one of the content pages in your latest crawl', {
      code: asApiErrorCode('validation_error'),
    });
  const suggestion = SUGGESTION_CONFLICTS[code];
  if (suggestion)
    return new ApiError(409, suggestion, { code: asApiErrorCode('agent_suggestion_conflict') });
  return new ApiError(409, 'Agent request conflicts with the current state', {
    code: asApiErrorCode(conflictCode(code)),
  });
}
/** Why a suggestion change was refused, in words the person can act on. */
const SUGGESTION_CONFLICTS: Readonly<Record<string, string>> = {
  suggestion_not_open: 'This suggestion is no longer open.',
  suggestion_not_ready:
    'This suggestion has no text to apply: it needs a fact from you or is advice only.',
  suggestion_not_revertible: 'Only an applied or dismissed suggestion can be reverted.',
  suggestion_revert_refused:
    'The text this suggestion changed was edited after it was applied, so reverting it would undo that edit.',
  suggestion_too_long: 'Applying it would make the page longer than a document can be.',
};
function conflictCode(code: string) {
  if (code === 'output_conflict') return 'agent_output_conflict';
  if (code === 'agent_skill_unknown') return 'validation_error';
  return code;
}
/** One interactive turn as server-sent events, with a heartbeat under proxy idle limits. */
function turnStream(
  execute: (events: TurnEvents) => Promise<unknown>,
  finished: () => Promise<z.infer<typeof agentRunSchema>>,
  onCancel: () => void,
) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    // The reader went away: the browser closed, so the turn stops.
    cancel: onCancel,
    start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const send = (event: z.input<typeof agentTurnEventSchema>) =>
        write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(
        () => write(': keep-alive\n\n'),
        agentPolicy.stream_heartbeat_seconds * 1000,
      );
      void execute({
        step: (event) => send({ type: 'step', ...event }),
        reply: (event) => send({ type: 'reply_delta', ...event }),
        document: (event) => send({ type: 'document_delta', ...event }),
        thinking: (event) => send({ type: 'thinking', ...event }),
        tool: (event) => send({ type: 'tool', ...event }),
      })
        .then(async () => send({ type: 'done', run: await finished() }))
        .catch((error: unknown) =>
          send({
            type: 'error',
            code: error instanceof ApiError ? error.code : 'agent_call_failed',
          }),
        )
        .finally(() => {
          clearInterval(heartbeat);
          if (open) controller.close();
          open = false;
        });
    },
  });
}

export const agentRoutes = [
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/runs/{run_id}/run',
    capability: 'run',
    params: {
      path: { ...chatPath, run_id: { scalar: { kind: 'uuid' }, required: true } },
      query: {},
    },
    response: agentRunSchema,
    raw: true,
    async handle({ db, c }, { path }) {
      const value = await chatScope(db, c, path.chat_id);
      const read = () =>
        db
          .selectFrom('agent_runs')
          .selectAll()
          .where('workspace_id', '=', value.workspaceId)
          .where('chat_id', '=', path.chat_id)
          .where('id', '=', path.run_id)
          .executeTakeFirst();
      const run = await read();
      if (!run) throw notFound('Agent run');
      const { queue, runtime } = await agentBindings(db);
      // The turn lives as long as this request: in-app navigation keeps the
      // browser's stream open, and closing the browser or stopping this
      // instance ends the turn as interrupted. Its frozen time limit ends it
      // as turn_timeout; a budget the runtime cannot read fails on load.
      const limit = budgetSchema.safeParse(run.budget);
      const slot = interactiveSlots.acquire();
      const gone = new AbortController();
      const signal = AbortSignal.any([
        c.req.raw.signal,
        gone.signal,
        slot.signal,
        ...(limit.success ? [AbortSignal.timeout(limit.data.turn_timeout_seconds * 1000)] : []),
      ]);
      const execute = (events?: TurnEvents) =>
        mapped(() =>
          runAgentOnce(queue, runtime, `interactive-agent:${randomUUID()}`, [value.workspaceId], {
            runId: path.run_id,
            signal,
            events,
          }),
        ).finally(slot.release);
      const finished = async () => {
        const run = await read();
        if (!run) throw notFound('Agent run');
        return runView(run);
      };
      if (!c.req.header('accept')?.includes('text/event-stream')) {
        await execute();
        return c.json(await finished());
      }
      return eventStreamResponse(turnStream(execute, finished, () => gone.abort()));
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/agent/skills',
    params: { path: {}, query: {} },
    response: agentSkillCatalogSchema,
    async handle({ db }) {
      const { catalog } = await agentBindings(db);
      const { workflows } = catalog;
      // Explicit projection: skill bodies and format guidance are model input only.
      return {
        skills: [...catalog.skills.values()].map((skill) => ({
          id: skill.id,
          label: skill.label,
          group: skill.group,
          output_kind: skill.outputKind,
          description: skill.description,
        })),
        workflow_groups: workflows.groups,
        workflows: workflows.workflows.map((workflow) => ({
          ...workflow,
          format_id: workflow.format_id ?? null,
        })),
        output_kinds: Object.entries(workflows.kinds).map(([kind, presentation]) => ({
          kind,
          label: presentation.label,
          refinements: presentation.refinements,
          next: presentation.next.map((step) => ({
            workflow_id: step.workflow,
            prompt: step.prompt,
          })),
        })),
        // The same bound the turn request schemas enforce.
        limits: { mentions_max: agentPolicy.mentions_max },
      };
    },
  }),
  defineGetRoute({
    ...projectFamily,
    path: '/api/v1/projects/{project_id}/agent/chats',
    params: {
      path: projectPath,
      query: {
        limit: {
          scalar: { kind: 'int', ge: 1, le: agentPolicy.list_max_limit },
          default: agentPolicy.list_default_limit,
        },
        q: { scalar: { kind: 'str', maxLength: agentPolicy.history_search_max_chars } },
        action_id: { scalar: { kind: 'uuid' } },
        cursor: { scalar: { kind: 'str', maxLength: 512 } },
      },
    },
    response: agentChatsPageSchema,
    async handle({ db, c }, { path, query }) {
      try {
        return await listChats(db, scope(c, path.project_id), {
          limit: query.limit,
          query: query.q ?? undefined,
          actionId: query.action_id ?? undefined,
          cursor: query.cursor ?? undefined,
        });
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof z.ZodError)
          throw new ApiError(400, 'Invalid chat cursor', {
            code: asApiErrorCode('invalid_cursor'),
          });
        throw error;
      }
    },
  }),
  definePostRoute({
    ...projectFamily,
    path: '/api/v1/projects/{project_id}/agent/chats',
    capability: 'run',
    params: { path: projectPath, query: {} },
    headers,
    body: body.create,
    response: agentChatCreatedSchema,
    status: 202,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.create),
        { store } = await agentBindings(db);
      // A page workflow answers with its chat and no turn until the page is read.
      const created = await mapped(() =>
        store.create(scope(c, path.project_id), {
          message: input.message,
          skillId: input.skill_id,
          workflowId: input.workflow_id ?? undefined,
          actionId: input.action_id ?? undefined,
          refs: z
            .record(z.string(), z.json())
            .parse(
              Object.fromEntries(
                Object.entries(input.context).filter(([, value]) => value != null),
              ),
            ),
          mentionIds: input.mentions,
          key: key(c),
        }),
      );
      return { chat_id: created.chatId, run: created.run ? runView(created.run) : null };
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}',
    params: { path: chatPath, query: {} },
    response: agentChatDetailSchema,
    async handle({ db, c }, { path }) {
      return readChat(db, workspaceOf(c), path.chat_id);
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/messages',
    capability: 'run',
    params: { path: chatPath, query: {} },
    headers,
    body: body.message,
    response: agentTurnAcceptedSchema,
    status: 202,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.message),
        value = await chatScope(db, c, path.chat_id),
        { store } = await agentBindings(db);
      const run = await mapped(() =>
        store.enqueue(value, {
          chatId: path.chat_id,
          message: input.message,
          skillId: input.skill_id,
          mentionIds: input.mentions,
          key: key(c),
        }),
      );
      return { chat_id: run.chat_id, run: runView(run) };
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/runs/{run_id}/cancel',
    capability: 'run',
    params: {
      path: { ...chatPath, run_id: { scalar: { kind: 'uuid' }, required: true } },
      query: {},
    },
    response: agentRunSchema,
    async handle({ db, c }, { path }) {
      const value = await chatScope(db, c, path.chat_id),
        { store } = await agentBindings(db);
      await mapped(() => store.cancel(value, path.chat_id, path.run_id));
      const run = await db
        .selectFrom('agent_runs')
        .selectAll()
        .where('workspace_id', '=', value.workspaceId)
        .where('chat_id', '=', path.chat_id)
        .where('id', '=', path.run_id)
        .executeTakeFirstOrThrow();
      return runView(run);
    },
  }),
  defineDeleteRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}',
    capability: 'run',
    params: { path: chatPath, query: {} },
    async handle({ db, c }, { path }) {
      const value = await chatScope(db, c, path.chat_id),
        { store } = await agentBindings(db);
      await mapped(() => store.archive(value, path.chat_id));
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/revisions',
    params: { path: outputPath, query: {} },
    response: agentRevisionsPageSchema,
    async handle({ db, c }, { path }) {
      return listRevisions(db, workspaceOf(c), path.chat_id, path.output_id);
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/revisions',
    capability: 'run',
    params: { path: outputPath, query: {} },
    body: body.edit,
    response: agentRevisionSchema,
    status: 201,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.edit),
        value = await chatScope(db, c, path.chat_id),
        { outputs } = await agentBindings(db);
      return revisionView(
        await mapped(() =>
          outputs.edit(value, path.chat_id, path.output_id, {
            baseId: input.base_revision_id,
            title: input.title,
            body: input.body,
          }),
        ),
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/revisions/{revision_id}/restore',
    capability: 'run',
    params: { path: revisionPath, query: {} },
    response: agentRevisionSchema,
    status: 201,
    async handle({ db, c }, { path }) {
      const value = await chatScope(db, c, path.chat_id),
        { outputs } = await agentBindings(db);
      return revisionView(
        await mapped(() => outputs.restore(value, path.chat_id, path.output_id, path.revision_id)),
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/target',
    capability: 'run',
    params: { path: outputPath, query: {} },
    body: body.target,
    response: agentChatDetailSchema,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.target),
        value = await chatScope(db, c, path.chat_id);
      await mapped(() =>
        changeIdleChat(db, value, path.chat_id, (trx, chat) =>
          chooseOutputTarget(trx, value, chat, path.output_id, input.decision),
        ),
      );
      return readChat(db, workspaceOf(c), path.chat_id);
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/suggestions',
    params: { path: outputPath, query: {} },
    response: agentSuggestionsPageSchema,
    async handle({ db, c }, { path }) {
      return listSuggestions(db, workspaceOf(c), path.chat_id, path.output_id);
    },
  }),
  suggestionRoute('apply'),
  suggestionRoute('dismiss'),
  suggestionRoute('revert'),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/suggestions/apply-all',
    capability: 'run',
    params: { path: outputPath, query: {} },
    body: body.suggestion,
    response: agentSuggestionsAppliedSchema,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.suggestion),
        value = await chatScope(db, c, path.chat_id),
        { suggestions } = await agentBindings(db);
      return mapped(() =>
        suggestions.applyAll(value, {
          chatId: path.chat_id,
          outputId: path.output_id,
          baseId: input.base_revision_id,
        }),
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/agent/chats/{chat_id}/outputs/{output_id}/suggestions/dismiss-all',
    capability: 'run',
    params: { path: outputPath, query: {} },
    body: body.suggestion,
    response: agentSuggestionsDismissedSchema,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.suggestion),
        value = await chatScope(db, c, path.chat_id),
        { suggestions } = await agentBindings(db);
      return mapped(() =>
        suggestions.dismissAll(value, {
          chatId: path.chat_id,
          outputId: path.output_id,
          baseId: input.base_revision_id,
        }),
      );
    },
  }),
  defineGetRoute({
    ...projectFamily,
    path: '/api/v1/projects/{project_id}/agent/instructions',
    params: { path: projectPath, query: {} },
    response: agentInstructionsSchema,
    async handle({ db, c }, { path }) {
      const value = scope(c, path.project_id);
      const row = await db
        .selectFrom('agent_instruction_revisions')
        .selectAll()
        .where('workspace_id', '=', value.workspaceId)
        .where('project_id', '=', value.projectId)
        .orderBy('revision', 'desc')
        .executeTakeFirst();
      return {
        revision: row?.revision ?? null,
        text: row?.text ?? '',
        created_at: row?.created_at.toISOString() ?? null,
      };
    },
  }),
  definePutRoute({
    ...projectFamily,
    path: '/api/v1/projects/{project_id}/agent/instructions',
    capability: 'run',
    params: { path: projectPath, query: {} },
    body: body.instructions,
    response: agentInstructionsSchema,
    async handle({ db, c }, { path }) {
      const input = await readBody(c, body.instructions),
        { outputs } = await agentBindings(db);
      const row = await mapped(() =>
        outputs.saveInstructions(scope(c, path.project_id), input.text.trim()),
      );
      return { revision: row.revision, text: row.text, created_at: row.created_at.toISOString() };
    },
  }),
];
