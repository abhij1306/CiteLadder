import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { fingerprint } from '../crypto-text.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { jsonObject } from '../db/json.ts';
import { authorize } from './access.ts';
import { SELF_HOSTED } from './funding.ts';
import {
  agentPolicy,
  AgentError,
  admittedBudget,
  type Chat,
  type Run,
  type Scope,
  type SkillCatalog,
  type Json,
} from './contracts.ts';
import { buildManifest, type ContextReader } from './context.ts';
import { active, endInterrupted, terminal } from './queue.ts';
import { appendMessage, appendRecoveryReply, getChat } from './messages.ts';

export type FundingIdentity = Pick<Run, 'funding_source' | 'requested_model'>;
/** Admission owns the model configuration check and abuse capacity, in this transaction.
 * It is injected deliberately, with no default. */
export type Admission = (db: Database, scope: Scope) => Promise<FundingIdentity>;
const messageSchema = z.string().trim().min(1).max(agentPolicy.message_max_chars);
export type TurnInput = {
  chatId?: string;
  message: string;
  key: string;
  skillId?: string | null;
  /** A defined workflow pins its skill and format; follow-ups inherit it. */
  workflowId?: string;
  actionId?: string;
  refs?: Record<string, Json>;
  mentionIds?: string[];
};

export async function requireIdle(db: Database, chat: Chat) {
  const run = await db
    .selectFrom('agent_runs')
    .select('id')
    .where('workspace_id', '=', chat.workspace_id)
    .where('chat_id', '=', chat.id)
    .where('status', 'in', active)
    .executeTakeFirst();
  if (run) throw new AgentError('agent_run_active');
}

function requestIdentity(scope: Scope, input: TurnInput) {
  if (input.chatId)
    return {
      op: 'send_message',
      chat: input.chatId,
      content: input.message,
      skill: input.skillId === undefined ? { mode: 'inherit' } : input.skillId,
      workflow: input.workflowId ?? null,
      mentions: input.mentionIds ?? [],
    };
  return {
    op: 'create_chat',
    project: scope.projectId,
    content: input.message,
    skill: input.skillId === undefined ? { mode: 'inherit' } : input.skillId,
    workflow: input.workflowId ?? null,
    action: input.actionId ?? null,
    context: input.refs ?? {},
    mentions: input.mentionIds ?? [],
  };
}
async function replayedRun(db: Database, scope: Scope, key: string, hash: string) {
  const replay = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
  if (!replay) return undefined;
  if (replay.project_id !== scope.projectId) throw notFound('Run');
  if (replay.user_id !== scope.userId) throw new AgentError('agent_idempotency_conflict');
  // Every runtime version shares one request fingerprint.
  if (replay.request_fingerprint !== hash) throw new AgentError('agent_idempotency_conflict');
  return replay;
}
function userSkillSource(skillId: string | null | undefined) {
  if (skillId) return 'user';
  return skillId === null ? 'automatic' : null;
}
function skillSource(
  explicit: string | null | undefined,
  pinned: string | null,
  id: string | null,
) {
  if (explicit) return 'user';
  if (pinned && explicit !== null) return 'chat';
  return id ? 'action' : null;
}

export class AgentStore {
  readonly db: Database;
  readonly dependencies: {
    admission: Admission;
    context: ContextReader;
    catalog: SkillCatalog;
    registryVersion: string;
    timeoutSeconds: number;
    /** A failed turn's settlement, for a Stop on a turn whose lease lapsed. */
    settleFailed: (db: Database, run: Run) => Promise<void>;
  };
  constructor(db: Database, dependencies: AgentStore['dependencies']) {
    this.db = db;
    this.dependencies = dependencies;
  }
  enqueue(scope: Scope, raw: TurnInput): Promise<Run> {
    const chosen = raw.workflowId
      ? this.dependencies.catalog.workflows?.byId.get(raw.workflowId)
      : undefined;
    if (raw.workflowId && !chosen)
      return Promise.reject(new AgentError('agent_workflow_unavailable'));
    const input = {
      ...raw,
      message: messageSchema.parse(raw.message),
      // A workflow is an explicit choice of its skill.
      ...(chosen ? { skillId: chosen.skill_id } : {}),
    };
    z.string().trim().min(1).max(agentPolicy.idempotency_key_max_chars).parse(input.key);
    // Canonical JSON binds nested refs as well as the visible message.
    const hash = fingerprint(requestIdentity(scope, input));
    const lockKey = 'agent-enqueue:' + scope.workspaceId;
    return this.db.transaction().execute(async (trx) => {
      await authorize(trx, scope);
      // Serialize workspace keys before chat locks: identical races share the winner.
      await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(trx);
      const replay = await replayedRun(trx, scope, input.key, hash);
      if (replay) return replay;
      const chat = input.chatId
        ? await getChat(trx, scope, input.chatId, true)
        : await this.createChat(trx, scope, input);
      if (chat.archived_at) throw notFound('Chat');
      await requireIdle(trx, chat);
      if (chat.turn_count >= agentPolicy.chat_turn_limit) throw new AgentError('agent_turn_limit');
      const funding = await this.dependencies.admission(trx, scope);
      z.literal(SELF_HOSTED).parse(funding.funding_source);
      const refs = z
        .record(z.string(), z.json())
        .parse(jsonObject(chat.context_refs, 'agent_chats.context_refs'));
      const manifest = await buildManifest(
        trx,
        scope,
        {
          refs,
          request: input.message,
          actionId: chat.action_id,
          mentionIds: input.mentionIds ?? [],
        },
        this.dependencies.context,
      );
      const skill = await this.turnSkill(
        trx,
        chat,
        input.skillId,
        manifest.action?.skill_id ?? null,
      );
      const workflow =
        chosen ?? (input.chatId ? await this.inheritedWorkflow(trx, chat, skill.id) : undefined);
      const message = await appendMessage(trx, chat, {
        role: 'user',
        content: input.message,
        userId: scope.userId,
        skillId: input.skillId,
        skillSource: userSkillSource(input.skillId),
        mentions: manifest.mentions.map((action) => ({
          kind: 'action',
          id: action.id,
          label: action.target_label,
        })),
      });
      const now = new Date();
      const run = await trx
        .insertInto('agent_runs')
        .values({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          chat_id: chat.id,
          user_message_id: message.id,
          user_id: scope.userId,
          idempotency_key: input.key,
          request_fingerprint: hash,
          requested_skill_id: skill.id,
          requested_skill_source: skill.source,
          context_manifest: {
            ...manifest,
            ...(workflow
              ? { workflow: { id: workflow.id, format_id: workflow.format_id ?? null } }
              : {}),
          },
          budget: admittedBudget(this.dependencies.timeoutSeconds),
          runtime_version: agentPolicy.runtime_version,
          protocol_version: agentPolicy.protocol_version,
          registry_version: this.dependencies.registryVersion,
          skill_catalog_version: this.dependencies.catalog.version,
          ...funding,
          max_attempts: agentPolicy.run_max_attempts,
          status: 'queued',
          priority: 0,
          randomized_position: 0,
          attempt_count: 0,
          available_at: sql<Date>`clock_timestamp()`,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          error_code: '',
          error_detail: '',
          created_at: now,
          updated_at: now,
          completed_at: null,
          skill_id: null,
          skill_source: null,
          skill_version: null,
          steps_used: 0,
          cancelled_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('agent_chats')
        .set({
          turn_count: chat.turn_count + 1,
          pinned_skill_id: input.skillId === undefined ? chat.pinned_skill_id : input.skillId,
          last_activity_at: now,
          updated_at: now,
        })
        .where('id', '=', chat.id)
        .where('workspace_id', '=', scope.workspaceId)
        .execute();
      return run;
    });
  }
  archive(scope: Scope, chatId: string) {
    return this.db.transaction().execute(async (trx) => {
      await authorize(trx, scope);
      const chat = await getChat(trx, scope, chatId, true);
      await requireIdle(trx, chat);
      await trx
        .updateTable('agent_chats')
        .set({ archived_at: new Date(), updated_at: new Date() })
        .where('id', '=', chat.id)
        .where('workspace_id', '=', scope.workspaceId)
        .execute();
    });
  }
  private createChat(db: Database, scope: Scope, input: TurnInput) {
    const now = new Date();
    return db
      .insertInto('agent_chats')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        created_by_user_id: scope.userId,
        title: input.message.slice(0, agentPolicy.chat_title_max_chars),
        action_id: input.actionId ?? null,
        context_refs: input.refs ?? {},
        pinned_skill_id: input.skillId ?? null,
        turn_count: 0,
        created_at: now,
        updated_at: now,
        last_activity_at: now,
        archived_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  /** A follow-up keeps its chat's workflow while it still runs that workflow's skill. */
  private async inheritedWorkflow(db: Database, chat: Chat, skillId: string | null) {
    const latest = await db
      .selectFrom('agent_runs')
      .select(sql<string | null>`context_manifest -> 'workflow' ->> 'id'`.as('workflow_id'))
      .where('workspace_id', '=', chat.workspace_id)
      .where('chat_id', '=', chat.id)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const workflow = latest?.workflow_id
      ? this.dependencies.catalog.workflows?.byId.get(latest.workflow_id)
      : undefined;
    return workflow?.skill_id === skillId ? workflow : undefined;
  }
  private async turnSkill(
    db: Database,
    chat: Chat,
    explicit: string | null | undefined,
    actionSkill: string | null,
  ) {
    const catalog = this.dependencies.catalog.skills;
    // A chat holds documents of several kinds, so any skill may run in it.
    const id =
      explicit ??
      (explicit === null ? null : chat.pinned_skill_id) ??
      (actionSkill && catalog.has(actionSkill) ? actionSkill : null);
    if (id && !catalog.has(id)) throw new AgentError('agent_skill_unknown');
    return { id, source: skillSource(explicit, chat.pinned_skill_id, id) };
  }
  cancel(scope: Scope, chatId: string, runId: string) {
    return this.db.transaction().execute(async (trx) => {
      await authorize(trx, scope);
      const run = await trx
        .selectFrom('agent_runs')
        .selectAll()
        .select(sql<boolean>`coalesce(lease_expires_at <= clock_timestamp(), false)`.as('lapsed'))
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('chat_id', '=', chatId)
        .where('id', '=', runId)
        .forUpdate()
        .executeTakeFirst();
      if (!run) throw notFound('Run');
      if (terminal.includes(run.status)) return;
      // A turn whose instance died ends as recovery would end it.
      if (run.lapsed) {
        await endInterrupted(trx, run, this.dependencies.settleFailed);
        return;
      }
      await trx
        .updateTable('agent_runs')
        .set({
          status: 'cancelled',
          cancelled_at: new Date(),
          completed_at: new Date(),
          error_code: 'cancelled',
          updated_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
        })
        .where('id', '=', run.id)
        .where('workspace_id', '=', scope.workspaceId)
        .execute();
      await appendRecoveryReply(trx, run, 'cancelled');
    });
  }
}
