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
} from '@citeladder/contracts/agent';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { containsPattern } from '../db/like.ts';
import { authorize } from './access.ts';
import { agentPolicy, type Chat, type Run, type Scope } from './contracts.ts';
import { currentOutput, revisionRefs } from './outputs.ts';
import { active } from './queue.ts';
import { getChat } from './messages.ts';
import { manifestSchema } from './context.ts';

const iso = (date: Date | null) => date?.toISOString() ?? null;
function summary(
  chat: Chat,
  output: { kind: string; phase: string } | null,
  label: string | null,
  running: boolean,
) {
  return agentChatSummarySchema.parse({
    ...chat,
    running,
    target_label: label,
    output_kind: output?.kind ?? null,
    output_phase: output?.phase ?? null,
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
export function revisionView(
  revision: Parameters<typeof revisionRefs>[0] & {
    id: string;
    created_at: Date;
    approved_at: Date | null;
    source_refs: unknown;
  },
) {
  return agentRevisionSchema.parse({
    ...revision,
    source_refs: revisionRefs(revision.source_refs),
    created_at: iso(revision.created_at),
    approved_at: iso(revision.approved_at),
  });
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
/** Each model call, followed by the reads its response made, in the order they finished. */
export async function progress(db: Database, run: Run) {
  if (run.attempt_count < 1) return [];
  const [models, tools] = await Promise.all([
    db
      .selectFrom('agent_model_attempts')
      .select(['id', 'ordinal', 'run_attempt', 'outcome'])
      .where('workspace_id', '=', run.workspace_id)
      .where('run_id', '=', run.id)
      .orderBy('run_attempt')
      .orderBy('ordinal')
      .execute(),
    db
      .selectFrom('agent_tool_attempts')
      .select([
        'id',
        'ordinal',
        'run_attempt',
        'call_id',
        'tool_name',
        'status',
        'registry_version',
      ])
      .where('workspace_id', '=', run.workspace_id)
      .where('run_id', '=', run.id)
      .orderBy('run_attempt')
      .orderBy('ordinal')
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
  ]);
  const live = active.includes(run.status);
  const versions = {
    runtime_version: run.runtime_version,
    protocol_version: run.protocol_version,
    skill_catalog_version: run.skill_catalog_version,
    projection_version: agentPolicy.progress_version,
  };
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
      model_attempt_id: model.id,
      tool_attempt_id: null,
      run_attempt: model.run_attempt,
      registry_version: run.registry_version,
      ...versions,
    }),
    ...tools
      .filter((tool) => tool.run_attempt === model.run_attempt && tool.ordinal === model.ordinal)
      .map((tool) =>
        agentRunStepSchema.parse({
          ordinal: tool.ordinal,
          status: tool.status,
          tool: tool.tool_name,
          call_id: tool.call_id,
          model_attempt_id: model.id,
          tool_attempt_id: tool.id,
          run_attempt: tool.run_attempt,
          registry_version: tool.registry_version,
          ...versions,
        }),
      ),
  ]);
}
export async function readChat(db: Database, scope: Scope, chatId: string) {
  await authorize(db, scope, false);
  const chat = await getChat(db, scope, chatId);
  const messages = await db
    .selectFrom('agent_messages')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('chat_id', '=', chat.id)
    .orderBy('sequence')
    .execute();
  const run = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('chat_id', '=', chat.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const current = await currentOutput(db, chat);
  const generated = current.output
    ? await db
        .selectFrom('agent_output_revisions')
        .select('message_id')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('output_id', '=', current.output.id)
        .where('author', '=', 'agent')
        .orderBy('number', 'desc')
        .limit(1)
        .executeTakeFirst()
    : undefined;
  const parsedManifest = run ? manifestSchema.safeParse(run.context_manifest) : null;
  const manifest = parsedManifest?.success ? parsedManifest.data : null;
  let limitations = manifest?.package.summary.omissions ?? [];
  if (run && !manifest) limitations = [{ reason: 'context_manifest_unavailable' }];
  const approvals = await db
    .selectFrom('agent_runs')
    .select(['id', 'user_message_id', 'context_manifest'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('chat_id', '=', chat.id)
    .where('mode', '=', 'draft_from_outline')
    .execute();
  const events = new Map(
    approvals.flatMap((approval) => {
      const parsed = manifestSchema.safeParse(approval.context_manifest);
      return parsed.success && parsed.data.approval
        ? [
            [
              approval.user_message_id,
              {
                kind: 'outline_approved' as const,
                revision_id: parsed.data.approval.revision_id,
                run_id: approval.id,
              },
            ] as const,
          ]
        : [];
    }),
  );
  const action = chat.action_id
    ? await db
        .selectFrom('actions')
        .select('target_label')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', '=', chat.action_id)
        .executeTakeFirst()
    : undefined;
  return agentChatDetailSchema.parse({
    chat: summary(
      chat,
      current.output,
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
    messages: messages.map((message) =>
      agentMessageSchema.parse({
        ...message,
        event: events.get(message.id) ?? null,
        created_at: iso(message.created_at),
        evidence_refs: revisionRefs(message.evidence_refs),
      }),
    ),
    latest_run: run ? runView(run, await progress(db, run)) : null,
    output: current.output
      ? agentOutputSchema.parse({
          ...current.output,
          message_id: generated?.message_id ?? null,
          latest_revision: current.revision
            ? agentRevisionSchema.parse({
                ...current.revision,
                source_refs: revisionRefs(current.revision.source_refs),
                created_at: iso(current.revision.created_at),
                approved_at: iso(current.revision.approved_at),
              })
            : null,
        })
      : null,
  });
}
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() });
export async function listRevisions(db: Database, scope: Scope, chatId: string) {
  await authorize(db, scope, false);
  const chat = await getChat(db, scope, chatId);
  const current = await currentOutput(db, chat);
  const revisions = current.output
    ? await db
        .selectFrom('agent_output_revisions')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('output_id', '=', current.output.id)
        .orderBy('number', 'desc')
        .limit(agentPolicy.revision_list_max)
        .execute()
    : [];
  return agentRevisionsPageSchema.parse({
    items: revisions.map((revision) =>
      agentRevisionSchema.parse({
        ...revision,
        source_refs: revisionRefs(revision.source_refs),
        created_at: iso(revision.created_at),
        approved_at: iso(revision.approved_at),
      }),
    ),
  });
}
export async function listChats(
  db: Database,
  scope: Scope,
  options: { limit?: number; cursor?: string; actionId?: string; query?: string } = {},
) {
  await authorize(db, scope, false);
  const limit = z
    .number()
    .int()
    .positive()
    .max(agentPolicy.list_max_limit)
    .parse(options.limit ?? agentPolicy.list_default_limit);
  let query = db
    .selectFrom('agent_chats as chat')
    .leftJoin('agent_outputs as output', (join) =>
      join
        .onRef('output.chat_id', '=', 'chat.id')
        .onRef('output.workspace_id', '=', 'chat.workspace_id'),
    )
    .leftJoin('actions as action', (join) =>
      join
        .onRef('action.id', '=', 'chat.action_id')
        .onRef('action.workspace_id', '=', 'chat.workspace_id')
        .onRef('action.project_id', '=', 'chat.project_id'),
    )
    .selectAll('chat')
    .select(['output.kind as output_kind', 'output.phase as output_phase', 'action.target_label'])
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
    items: page.map((row) =>
      summary(
        row,
        row.output_kind ? { kind: row.output_kind, phase: row.output_phase! } : null,
        row.target_label,
        Boolean(row.running),
      ),
    ),
    next_cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString('base64url')
        : null,
  });
}
