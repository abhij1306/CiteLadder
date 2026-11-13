import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { fingerprint } from '../crypto-text.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { jsonObject } from '../db/json.ts';
import { authorize } from './access.ts';
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
import {
  enqueuePageFetch,
  pageFetchActive,
  pageFetchByRequest,
  pageFetchPayloadSchema,
  pageTurnKey,
  type PageFetchPayload,
} from '../page-documents/keys.ts';
import { resolvePageTarget } from '../page-documents/target.ts';
import { buildManifest, type ContextReader, type Manifest } from './context.ts';
import { active, endInterrupted, terminal } from './queue.ts';
import { appendMessage, appendRecoveryReply, getChat } from './messages.ts';
import { requestedPageUrl } from './page-url.ts';
import { fetchesPage } from './skills.ts';
import type { WorkflowCatalog } from './workflows.ts';

export type AdmittedModel = Pick<Run, 'requested_model'>;
/** Admission owns the model configuration check and abuse capacity, in this transaction.
 * It is injected deliberately, with no default. */
export type Admission = (db: Database, scope: Scope) => Promise<AdmittedModel>;
/**
 * Creates or reuses the Action a new page chat works on, in the chat's own
 * transaction, so a refused admission leaves no Action behind. Returns its id.
 */
type AttachChatAction = (trx: Database) => Promise<string>;
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

async function requireNoActiveRun(db: Database, chat: Chat) {
  const run = await db
    .selectFrom('agent_runs')
    .select('id')
    .where('workspace_id', '=', chat.workspace_id)
    .where('chat_id', '=', chat.id)
    .where('status', 'in', active)
    .executeTakeFirst();
  if (run) throw new AgentError('agent_run_active');
}
/** No turn is queued or running, and no page is being read for the chat's first turn. */
export async function requireIdle(db: Database, chat: Chat) {
  await requireNoActiveRun(db, chat);
  if (await pageFetchActive(db, chat.workspace_id, chat.id))
    throw new AgentError('agent_run_active');
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
type Workflow = NonNullable<ReturnType<WorkflowCatalog['byId']['get']>>;
/** The Actions a message @-mentioned, as resolved when it was sent. */
function mentionsOf(manifest: Manifest) {
  return manifest.mentions.map((action) => ({
    kind: 'action',
    id: action.id,
    label: action.target_label,
  }));
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
    /** Closes a failed turn's unanswered model calls, for a Stop on a turn whose lease lapsed. */
    reconcile: (db: Database, run: Run) => Promise<void>;
  };
  constructor(db: Database, dependencies: AgentStore['dependencies']) {
    this.db = db;
    this.dependencies = dependencies;
  }
  /** The workflow a request names; a missing one is refused. */
  private workflowFor(workflowId: string | undefined) {
    if (!workflowId) return undefined;
    const chosen = this.dependencies.catalog.workflows?.byId.get(workflowId);
    if (!chosen) throw new AgentError('agent_workflow_unavailable');
    return chosen;
  }
  /** Whether the workflow's skill writes a fetched page, so its chat starts with a page fetch. */
  private startsWithFetch(workflow: Workflow | undefined) {
    const skill = workflow ? this.dependencies.catalog.skills.get(workflow.skill_id) : undefined;
    return skill !== undefined && fetchesPage(skill);
  }
  /** The request as admitted: a bounded message and key, its workflow's skill, its fingerprint. */
  private admitted(scope: Scope, raw: TurnInput, chosen: Workflow | undefined) {
    const input = {
      ...raw,
      message: messageSchema.parse(raw.message),
      // A workflow is an explicit choice of its skill.
      ...(chosen ? { skillId: chosen.skill_id } : {}),
    };
    z.string().trim().min(1).max(agentPolicy.idempotency_key_max_chars).parse(input.key);
    // Canonical JSON binds nested refs as well as the visible message.
    return { input, hash: fingerprint(requestIdentity(scope, input)) };
  }
  /** One workspace's admissions run one at a time: identical races share the winner. */
  private async lockWorkspace(trx: Database, scope: Scope) {
    await authorize(trx, scope);
    // Serialize workspace keys before chat locks.
    await subjectXactLock(trx, `agent-enqueue:${scope.workspaceId}`);
  }
  /**
   * A new chat. A page workflow (`optimize_page`) commits the chat and its
   * page fetch, and no turn: the fetch queues the turn once the page is read,
   * so a failed fetch never calls a model (B73). Any other request commits its
   * first turn. `attach` (page chats only) names the chat's Action from inside
   * that transaction (Analyze a page).
   */
  async create(
    scope: Scope,
    raw: TurnInput,
    attach?: AttachChatAction,
  ): Promise<{ chatId: string; run: Run | null }> {
    const chosen = this.workflowFor(raw.workflowId);
    if (this.startsWithFetch(chosen) && chosen)
      return this.startPageChat(scope, raw, chosen, attach);
    if (attach) throw new AgentError('agent_workflow_unavailable');
    const run = await this.enqueue(scope, raw);
    return { chatId: run.chat_id, run };
  }
  enqueue(scope: Scope, raw: TurnInput): Promise<Run> {
    let chosen: Workflow | undefined;
    try {
      chosen = this.workflowFor(raw.workflowId);
    } catch (error) {
      return Promise.reject(error);
    }
    // A page workflow's chat starts with its page fetch, never with a turn.
    if (this.startsWithFetch(chosen))
      return Promise.reject(new AgentError('agent_workflow_unavailable'));
    const { input, hash } = this.admitted(scope, raw, chosen);
    return this.db.transaction().execute(async (trx) => {
      await this.lockWorkspace(trx, scope);
      const replay = await replayedRun(trx, scope, input.key, hash);
      if (replay) return replay;
      const chat = input.chatId
        ? await getChat(trx, scope, input.chatId, true)
        : await this.createChat(trx, scope, input);
      if (chat.archived_at) throw notFound('Chat');
      await requireIdle(trx, chat);
      if (chat.turn_count >= agentPolicy.chat_turn_limit) throw new AgentError('agent_turn_limit');
      const admitted = await this.dependencies.admission(trx, scope);
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
      const skill = this.turnSkill(chat, input.skillId, manifest.action?.skill_id ?? null);
      const workflow =
        chosen ?? (input.chatId ? await this.inheritedWorkflow(trx, chat, skill.id) : undefined);
      const message = await appendMessage(trx, chat, {
        role: 'user',
        content: input.message,
        userId: scope.userId,
        skillId: input.skillId,
        skillSource: userSkillSource(input.skillId),
        mentions: mentionsOf(manifest),
      });
      return this.queueTurn(trx, scope, {
        chat,
        messageId: message.id,
        key: input.key,
        hash,
        admitted,
        skill,
        workflow,
        manifest,
        pinnedSkillId: input.skillId === undefined ? chat.pinned_skill_id : input.skillId,
      });
    });
  }
  /** Inserts one queued turn and counts it against the chat. */
  private async queueTurn(
    trx: Database,
    scope: Scope,
    turn: {
      chat: Chat;
      messageId: string;
      key: string;
      hash: string;
      admitted: AdmittedModel;
      skill: Awaited<ReturnType<AgentStore['turnSkill']>>;
      workflow: Workflow | undefined;
      manifest: Manifest;
      pinnedSkillId: string | null;
    },
  ) {
    const { chat, skill, workflow, manifest } = turn;
    const now = new Date();
    const run = await trx
      .insertInto('agent_runs')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        chat_id: chat.id,
        user_message_id: turn.messageId,
        user_id: scope.userId,
        idempotency_key: turn.key,
        request_fingerprint: turn.hash,
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
        requested_model: turn.admitted.requested_model,
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
        pinned_skill_id: turn.pinnedSkillId,
        last_activity_at: now,
        updated_at: now,
      })
      .where('id', '=', chat.id)
      .where('workspace_id', '=', scope.workspaceId)
      .execute();
    return run;
  }
  /** The page a page chat fetches: the request's page, else its Action's, else one its message names. */
  private async requestedPage(trx: Database, scope: Scope, input: TurnInput) {
    const named = input.refs?.target_url;
    if (typeof named === 'string' && named.trim()) return named;
    if (input.actionId) {
      const action = await trx
        .selectFrom('actions')
        .select('target_url')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', '=', input.actionId)
        .executeTakeFirst();
      if (action?.target_url) return action.target_url;
    }
    const project = await trx
      .selectFrom('projects')
      .select('website_url')
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', scope.projectId)
      .executeTakeFirstOrThrow();
    return requestedPageUrl(input.message, project.website_url);
  }
  /** A retried page-chat request: the chat it created, and its turn once the fetch queued one. */
  private async replayedPageChat(trx: Database, scope: Scope, key: string, hash: string) {
    const task = await pageFetchByRequest(trx, scope.workspaceId, key);
    if (!task) return undefined;
    if (task.project_id !== scope.projectId) throw notFound('Run');
    const payload = pageFetchPayloadSchema.parse(task.payload);
    if (payload.user_id !== scope.userId || payload.request_fingerprint !== hash)
      throw new AgentError('agent_idempotency_conflict');
    const run = await trx
      .selectFrom('agent_runs')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('idempotency_key', '=', pageTurnKey(task.id))
      .executeTakeFirst();
    return { chatId: payload.chat_id, run: run ?? null };
  }
  /**
   * A page chat: the page must be one of the latest crawl's content pages or
   * the Action's own target. Admission (model configuration, abuse budget) runs
   * now, so a refused workspace fetches nothing; the admitted model is frozen
   * into the fetch for the turn it queues.
   */
  private startPageChat(
    scope: Scope,
    raw: TurnInput,
    chosen: Workflow,
    attach: AttachChatAction | undefined,
  ) {
    const admitted = this.admitted(scope, raw, chosen);
    const { hash } = admitted;
    return this.db.transaction().execute(async (trx) => {
      await this.lockWorkspace(trx, scope);
      const replay = await replayedRun(trx, scope, admitted.input.key, hash);
      if (replay) return { chatId: replay.chat_id, run: replay };
      const replayed = await this.replayedPageChat(trx, scope, admitted.input.key, hash);
      if (replayed) return replayed;
      const input = attach ? { ...admitted.input, actionId: await attach(trx) } : admitted.input;
      const page = await resolvePageTarget(trx, scope, {
        url: await this.requestedPage(trx, scope, input),
        actionId: input.actionId ?? null,
      });
      const { requested_model } = await this.dependencies.admission(trx, scope);
      const refs = { ...input.refs, target_url: page.url };
      // Every reference resolves now, so a page is never fetched for a chat whose context cannot load.
      const manifest = await buildManifest(
        trx,
        scope,
        {
          refs,
          request: input.message,
          actionId: input.actionId ?? null,
          mentionIds: input.mentionIds ?? [],
        },
        this.dependencies.context,
      );
      const chat = await this.createChat(trx, scope, { ...input, refs });
      const message = await appendMessage(trx, chat, {
        role: 'user',
        content: input.message,
        userId: scope.userId,
        skillId: chosen.skill_id,
        skillSource: userSkillSource(chosen.skill_id),
        mentions: mentionsOf(manifest),
      });
      await enqueuePageFetch(trx, scope, {
        chat_id: chat.id,
        url: page.url,
        site_url_id: page.siteUrlId,
        action_id: chat.action_id,
        user_message_id: message.id,
        user_id: scope.userId,
        request_key: input.key,
        request_fingerprint: hash,
        requested_model,
        workflow_id: chosen.id,
        mention_ids: input.mentionIds ?? [],
      });
      return { chatId: chat.id, run: null };
    });
  }
  /**
   * The first turn of a page chat, queued by its page fetch once the page is
   * read, in the fetch's terminal transaction. It answers the chat's first
   * message with the model admission chose, and its context names the
   * snapshot, so every later turn reads the fetched page's checks too.
   */
  async queueFetchedTurn(
    trx: Database,
    fetch: { taskId: string; workspaceId: string; projectId: string; payload: PageFetchPayload },
    snapshotId: string,
  ) {
    const { payload } = fetch;
    const scope = {
      workspaceId: fetch.workspaceId,
      projectId: fetch.projectId,
      userId: payload.user_id,
    };
    await this.lockWorkspace(trx, scope);
    const workflow = this.workflowFor(payload.workflow_id);
    const chat = await getChat(trx, scope, payload.chat_id, true);
    if (chat.archived_at) throw notFound('Chat');
    // The fetch itself is still running, so only a turn makes the chat busy here.
    await requireNoActiveRun(trx, chat);
    const message = await trx
      .selectFrom('agent_messages')
      .select(['id', 'content'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('chat_id', '=', chat.id)
      .where('id', '=', payload.user_message_id)
      .executeTakeFirstOrThrow();
    const refs = {
      ...z
        .record(z.string(), z.json())
        .parse(jsonObject(chat.context_refs, 'agent_chats.context_refs')),
      page_snapshot_reference: { snapshot_id: snapshotId },
    };
    await trx
      .updateTable('agent_chats')
      .set({ context_refs: refs })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', chat.id)
      .execute();
    const manifest = await buildManifest(
      trx,
      scope,
      {
        refs,
        request: message.content,
        actionId: chat.action_id,
        mentionIds: payload.mention_ids,
      },
      this.dependencies.context,
    );
    return this.queueTurn(trx, scope, {
      chat,
      messageId: message.id,
      key: pageTurnKey(fetch.taskId),
      hash: payload.request_fingerprint,
      admitted: { requested_model: payload.requested_model },
      skill: this.turnSkill(chat, workflow?.skill_id ?? null, manifest.action?.skill_id ?? null),
      workflow,
      manifest,
      pinnedSkillId: chat.pinned_skill_id,
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
  private turnSkill(chat: Chat, explicit: string | null | undefined, actionSkill: string | null) {
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
        await endInterrupted(trx, run, this.dependencies.reconcile);
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
