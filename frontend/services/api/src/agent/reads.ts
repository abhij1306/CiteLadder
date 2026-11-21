import { z } from 'zod';
import { sql } from 'kysely';
import {
  agentChatDetailSchema,
  agentChatSummarySchema,
  agentChatsPageSchema,
  agentMessageSchema,
  agentOutputSchema,
  agentRevisionSchema,
  agentRevisionsPageSchema,
  agentRunSchema,
  agentRunStepSchema,
  agentStepSchema,
  type AgentChatOrigin,
} from '@citeladder/contracts/agent';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { containsPattern } from '../db/like.ts';
import { agentPolicy, type Chat, type Run, type Scope } from './contracts.ts';
import { chatDocuments, latestDocument, revisionRefs, revisionWebSources } from './outputs.ts';
import { active } from './queue.ts';
import { workspaceChat } from './messages.ts';
import { manifestSchema } from './context.ts';
import { pageFetchView } from '../page-documents/reads.ts';
import { statusView } from '../opportunities/action-status.ts';
import { openTargetChoice } from './target-adapter.ts';
import { stepTarget } from './sources.ts';

const iso = (date: Date | null) => date?.toISOString() ?? null;
// First present reference wins; `action_id` can be attached after the chat started, so it ranks last.
const ORIGIN_REFS: readonly [AgentChatOrigin, readonly string[]][] = [
  ['site_health', ['issue_group_reference', 'site_facts_reference', 'site_health_reference']],
  [
    'page',
    ['target_url', 'target_site_url_id', 'page_snapshot_reference', 'url_actions_reference'],
  ],
  ['recommendation', ['opportunity_id']],
  ['demand', ['demand_signal_id']],
  ['keyword_research', ['search_intelligence_reference']],
  ['prompts', ['prompt_reference']],
  ['objection', ['objection_group_id']],
];
export function chatOrigin(chat: Pick<Chat, 'context_refs' | 'action_id'>): AgentChatOrigin {
  const refs = jsonObject(chat.context_refs, 'agent_chats.context_refs');
  const found = ORIGIN_REFS.find(([, keys]) => keys.some((key) => refs[key] != null));
  if (found) return found[0];
  return chat.action_id ? 'action' : 'chat';
}
function summary(chat: Chat, outputKind: string | null, label: string | null, running: boolean) {
  return agentChatSummarySchema.parse({
    ...chat,
    origin: chatOrigin(chat),
    running,
    target_label: label,
    output_kind: outputKind,
    last_activity_at: iso(chat.last_activity_at),
    created_at: iso(chat.created_at),
  });
}
export function runView(run: Run, steps: z.input<typeof agentRunStepSchema>[] = []) {
  return agentRunSchema.parse({
    ...run,
    skill_id: run.skill_id ?? run.requested_skill_id,
    skill_source: run.skill_source ?? run.requested_skill_source,
    created_at: iso(run.created_at),
    completed_at: iso(run.completed_at),
    progress: steps,
  });
}
export function revisionView(revision: {
  created_at: Date;
  source_refs: unknown;
  web_sources: unknown;
}) {
  return agentRevisionSchema.parse({
    ...revision,
    source_refs: revisionRefs(revision.source_refs),
    web_sources: revisionWebSources(revision.web_sources),
    created_at: iso(revision.created_at),
  });
}
function messageSteps(steps: unknown) {
  return z.array(agentStepSchema).parse(steps);
}
function modelStepStatus(outcome: string, latest: boolean) {
  if (outcome === 'dispatched') return 'working';
  if (outcome !== 'completed') return outcome;
  return latest ? 'processing' : 'reasoned';
}
function pendingStepStatus(outcome: string, live: boolean, latest: boolean) {
  if (live) return modelStepStatus(outcome, latest);
  return outcome === 'dispatched' ? 'interrupted' : modelStepStatus(outcome, false);
}
export async function progress(db: Database, run: Run) {
  if (run.attempt_count < 1) return [];
  const [models, tools] = await Promise.all([
    db
      .selectFrom('agent_model_attempts')
      .select(['ordinal', 'run_attempt', 'outcome'])
      .where('workspace_id', '=', run.workspace_id)
      .where('run_id', '=', run.id)
      .orderBy('run_attempt')
      .orderBy('ordinal')
      .execute(),
    db
      .selectFrom('agent_tool_attempts')
      .select(['id', 'ordinal', 'run_attempt', 'call_id', 'tool_name', 'status', 'input'])
      .where('workspace_id', '=', run.workspace_id)
      .where('run_id', '=', run.id)
      .orderBy('run_attempt')
      .orderBy('ordinal')
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
  ]);
  const live = active.includes(run.status);
  return models.flatMap((model, index) => [
    agentRunStepSchema.parse({
      ordinal: model.ordinal,
      status: pendingStepStatus(
        model.outcome,
        model.run_attempt === run.attempt_count && live,
        index === models.length - 1,
      ),
      tool: null,
      call_id: null,
      run_attempt: model.run_attempt,
      target: null,
    }),
    ...tools
      .filter((tool) => tool.run_attempt === model.run_attempt && tool.ordinal === model.ordinal)
      .map((tool) =>
        agentRunStepSchema.parse({
          ordinal: tool.ordinal,
          status: tool.status,
          tool: tool.tool_name,
          call_id: tool.call_id,
          run_attempt: tool.run_attempt,
          target: stepTarget(tool.input),
        }),
      ),
  ]);
}
/**
 * A chat in the workspace, with its project read from the chat itself. The
 * caller has authorized the workspace (the request's session read), so the
 * chat is read once and nothing re-checks the membership.
 */
async function chatIn(db: Database, workspace: Pick<Scope, 'workspaceId'>, chatId: string) {
  const chat = await workspaceChat(db, workspace.workspaceId, chatId);
  return { chat, scope: { workspaceId: chat.workspace_id, projectId: chat.project_id } };
}

const ACTION_REF =
  /^citeladder:\/\/action\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;

async function referencedActions(
  db: Database,
  scope: Pick<Scope, 'workspaceId' | 'projectId'>,
  thread: readonly Pick<
    z.infer<typeof agentMessageSchema>,
    'evidence_refs' | 'mentions' | 'proposals'
  >[],
) {
  const ids = new Set<string>();
  for (const message of thread) {
    for (const ref of message.evidence_refs) {
      const id = ACTION_REF.exec(ref)?.[1];
      if (id) ids.add(id);
    }
    for (const mention of message.mentions) if (mention.kind === 'action') ids.add(mention.id);
    for (const proposal of message.proposals) ids.add(proposal.action_id);
  }
  if (!ids.size) return [];
  const rows = await db
    .selectFrom('actions')
    .select(['id', 'target_label', 'effective_status as status'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', 'in', [...ids])
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ ...row, status: statusView(row.status).status }));
}

export async function readChat(
  db: Database,
  workspace: Pick<Scope, 'workspaceId'>,
  chatId: string,
) {
  const { chat, scope } = await chatIn(db, workspace, chatId);
  const [messages, run, documents] = await Promise.all([
    db
      .selectFrom('agent_messages')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('chat_id', '=', chat.id)
      .orderBy('sequence')
      .execute(),
    db
      .selectFrom('agent_runs')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('chat_id', '=', chat.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst(),
    chatDocuments(db, chat),
  ]);
  const generated = documents.length
    ? await db
        .selectFrom('agent_output_revisions')
        .select(['output_id', 'message_id'])
        .distinctOn('output_id')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where(
          'output_id',
          'in',
          documents.map(({ output }) => output.id),
        )
        .where('author', '=', 'agent')
        .orderBy('output_id')
        .orderBy('number', 'desc')
        .execute()
    : [];
  const generatedBy = new Map(generated.map((row) => [row.output_id, row.message_id]));
  const outputActionIds = [
    ...new Set(documents.flatMap(({ output }) => (output.action_id ? [output.action_id] : []))),
  ];
  const outputActions = outputActionIds.length
    ? await db
        .selectFrom('actions')
        .select(['id', 'target_kind', 'target_label'])
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', 'in', outputActionIds)
        .execute()
    : [];
  const actionTargets = new Map(outputActions.map((row) => [row.id, row]));
  const parsedManifest = run ? manifestSchema.safeParse(run.context_manifest) : null;
  const manifest = parsedManifest?.success ? parsedManifest.data : null;
  let limitations = manifest?.package.summary.omissions ?? [];
  if (run && !manifest) limitations = [{ reason: 'context_manifest_unavailable' }];
  const action = chat.action_id
    ? await db
        .selectFrom('actions')
        .select('target_label')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', '=', chat.action_id)
        .executeTakeFirst()
    : undefined;
  const thread = messages.map((message) =>
    agentMessageSchema.parse({
      ...message,
      created_at: iso(message.created_at),
      evidence_refs: revisionRefs(message.evidence_refs),
      web_sources: revisionWebSources(message.web_sources),
      steps: messageSteps(message.steps),
    }),
  );
  return agentChatDetailSchema.parse({
    chat: summary(
      chat,
      latestDocument(documents)?.output.kind ?? null,
      action?.target_label ?? null,
      run ? active.includes(run.status) : false,
    ),
    pinned_skill_id: chat.pinned_skill_id,
    context: {
      refs: jsonObject(chat.context_refs, 'agent_chats.context_refs'),
      instructions: manifest?.instructions ? { revision: manifest.instructions.revision } : null,
      action: manifest?.action
        ? { id: manifest.action.id, label: manifest.action.target_label }
        : null,
      mentions:
        manifest?.mentions.map((action) => ({ id: action.id, label: action.target_label })) ?? [],
      sources: manifest?.package.summary.provenance ?? [],
      limitations,
      prompt: {
        ...manifest?.prompt_summary,
        ...(manifest
          ? {
              context_version: manifest.version,
              package_version: manifest.package.version,
              selection_policy_version: manifest.package.summary.selection_policy_version ?? null,
            }
          : {}),
      },
    },
    messages: thread,
    actions: await referencedActions(db, scope, thread),
    latest_run: run ? runView(run, await progress(db, run)) : null,
    page_fetch: await pageFetchView(db, chat),
    outputs: documents.map(({ output, revision }) =>
      agentOutputSchema.parse({
        ...output,
        message_id: generatedBy.get(output.id) ?? null,
        named_target: openTargetChoice(
          output,
          output.action_id ? actionTargets.get(output.action_id) : undefined,
        ),
        latest_revision: revisionView(revision),
      }),
    ),
  });
}
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() });
export async function listRevisions(
  db: Database,
  workspace: Pick<Scope, 'workspaceId'>,
  chatId: string,
  outputId: string,
) {
  const { chat, scope } = await chatIn(db, workspace, chatId);
  const revisions = await db
    .selectFrom('agent_output_revisions as revision')
    .innerJoin('agent_outputs as output', (join) =>
      join
        .onRef('output.id', '=', 'revision.output_id')
        .onRef('output.workspace_id', '=', 'revision.workspace_id'),
    )
    .selectAll('revision')
    .where('revision.workspace_id', '=', scope.workspaceId)
    .where('revision.project_id', '=', scope.projectId)
    .where('output.chat_id', '=', chat.id)
    .where('output.id', '=', outputId)
    .orderBy('revision.number', 'desc')
    .limit(agentPolicy.revision_list_max)
    .execute();
  return agentRevisionsPageSchema.parse({
    items: revisions.map((revision) => revisionView(revision)),
  });
}
export async function listChats(
  db: Database,
  scope: Pick<Scope, 'workspaceId' | 'projectId'>,
  options: { limit?: number; cursor?: string; actionId?: string; query?: string } = {},
) {
  const limit = z
    .number()
    .int()
    .positive()
    .max(agentPolicy.list_max_limit)
    .parse(options.limit ?? agentPolicy.list_default_limit);
  let query = db
    .selectFrom('agent_chats as chat')
    .leftJoin('actions as action', (join) =>
      join
        .onRef('action.id', '=', 'chat.action_id')
        .onRef('action.workspace_id', '=', 'chat.workspace_id')
        .onRef('action.project_id', '=', 'chat.project_id'),
    )
    .selectAll('chat')
    .select('action.target_label')
    .select((eb) =>
      eb
        .selectFrom('agent_outputs as output')
        .select('output.kind')
        .whereRef('output.workspace_id', '=', 'chat.workspace_id')
        .whereRef('output.chat_id', '=', 'chat.id')
        .orderBy('output.updated_at', 'desc')
        .orderBy('output.number', 'desc')
        .limit(1)
        .as('output_kind'),
    )
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom('agent_runs as run')
            .select('run.id')
            .whereRef('run.workspace_id', '=', 'chat.workspace_id')
            .whereRef('run.chat_id', '=', 'chat.id')
            .where('run.status', 'in', active),
        )
        .as('running'),
    )
    .select(
      sql<string>`to_char(chat.last_activity_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
        'cursor_at',
      ),
    )
    .where('chat.workspace_id', '=', scope.workspaceId)
    .where('chat.project_id', '=', scope.projectId)
    .where('chat.archived_at', 'is', null);
  if (options.actionId) query = query.where('chat.action_id', '=', options.actionId);
  if (options.query) {
    const search = z.string().trim().max(agentPolicy.history_search_max_chars).parse(options.query);
    const pattern = containsPattern(search);
    query = query.where((eb) =>
      eb.or([
        eb('chat.title', 'ilike', pattern),
        eb.exists(
          eb
            .selectFrom('agent_messages as message')
            .select('message.id')
            .whereRef('message.workspace_id', '=', 'chat.workspace_id')
            .whereRef('message.project_id', '=', 'chat.project_id')
            .whereRef('message.chat_id', '=', 'chat.id')
            .where('message.content', 'ilike', pattern),
        ),
      ]),
    );
  }
  if (options.cursor) {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')),
    );
    const instant = sql<Date>`${cursor.at}::timestamptz`;
    query = query.where((eb) =>
      eb.or([
        eb('chat.last_activity_at', '<', instant),
        eb.and([eb('chat.last_activity_at', '=', instant), eb('chat.id', '<', cursor.id)]),
      ]),
    );
  }
  const rows = await query
    .orderBy('chat.last_activity_at', 'desc')
    .orderBy('chat.id', 'desc')
    .limit(limit + 1)
    .execute();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return agentChatsPageSchema.parse({
    items: page.map((row) => summary(row, row.output_kind, row.target_label, Boolean(row.running))),
    next_cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString('base64url')
        : null,
  });
}
