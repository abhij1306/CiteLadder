import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { ModelError } from '../models/http.ts';
import type { ConversationBlock, ConversationMessage, ToolCall } from '../models/conversation.ts';
import { authorize } from './access.ts';
import {
  isBuiltin,
  agentToolList,
  loadSkill,
  methodology,
  saveDocument,
  LOAD_SKILL,
  SAVE_DOCUMENT,
  type DocumentState,
} from './builtin-tools.ts';
import {
  agentPolicy,
  AgentError,
  budgetSchema,
  type Budget,
  type Json,
  type Lease,
  type Scope,
  type SkillCatalog,
} from './contracts.ts';
import { contextCitations, manifestSchema, suppliedManifest } from './context.ts';
import { ModelCalls, type AgentModel, type ModelRequest } from './model-calls.ts';
import { currentOutput, revisionRefs, saveAgentOutput, type AttachTarget } from './outputs.ts';
import { lockRun, terminalize } from './queue.ts';
import { appendMessage, appendRecoveryReply, getChat, touchChat } from './messages.ts';
import { outlineRequired } from './skills.ts';
import { readSources, scrubRecordRefs, uniqueSources } from './sources.ts';
import { documentEmitter, type TurnEvents } from './stream.ts';
import {
  chatTranscripts,
  openingMessage,
  replayed,
  saveTranscript,
  systemPrefix,
} from './transcript.ts';
import { leaseSignal } from '../queue/heartbeat.ts';
import { refused, ToolRegistry, type ToolOutcome } from './tools.ts';

function failureCode(error: unknown) {
  if (error instanceof AgentError) return error.code;
  if (error instanceof ApiError && [403, 404].includes(error.status)) return 'access_revoked';
  if (error instanceof ModelError) return 'provider_error';
  // Validation and storage defects are ours, not the model provider's.
  return 'internal_error';
}
type StepRecord = {
  kind: 'model' | 'skill' | 'document' | 'tool';
  ordinal?: number;
  skill_id?: string;
  tool?: string;
  status?: string;
  call_id?: string;
};
type PromptSummary = Record<string, Json>;
type TurnState = DocumentState & {
  /** Records this turn's reads returned: the reply's sources. */
  read: string[];
  steps: StepRecord[];
  toolsUsed: number;
  /** This turn's messages, appended in order and persisted as its transcript. */
  messages: ConversationMessage[];
  contextHash: string;
};
export function bounded(text: string, limit: number, marker: string) {
  return text.length <= limit
    ? text
    : text.slice(0, Math.max(0, limit - marker.length)) + marker.slice(0, limit);
}
export type RuntimeDependencies = {
  catalog: SkillCatalog;
  tools: ToolRegistry;
  models: ModelCalls;
  modelFor: (run: Awaited<ReturnType<typeof lockRun>>) => AgentModel | Promise<AgentModel>;
  attachTarget: AttachTarget;
};
type Turn = Awaited<ReturnType<AgentRuntime['load']>>;
/** The saved document's format, else the one its workflow pinned. */
function currentFormat(turn: Turn) {
  return turn.current.output?.format_id ?? turn.manifest.workflow?.format_id ?? null;
}
/** Merges the last prompt summary into the frozen manifest without rewriting it. */
function withSummary(summary: PromptSummary) {
  return {
    context_manifest: sql<Json>`context_manifest || jsonb_build_object('prompt_summary', ${JSON.stringify(summary)}::jsonb)`,
  };
}
const SAVED_PHASE: Record<string, string> = { outline: 'Outline saved', draft: 'Draft saved' };
function savedNotice(phase: string, formatLabel: string | null) {
  const format = formatLabel ? ` in ${formatLabel} format` : '';
  const approval = phase === 'outline' ? ' Approve it before requesting a draft.' : '';
  return `${SAVED_PHASE[phase] ?? 'Document saved'}${format}.${approval}`;
}
/** A turn never ends without a reply, even when the model wrote none. */
function noReply(reads: number) {
  const read = reads === 1 ? 'one read' : `${reads} reads`;
  return reads
    ? `I completed ${read} but reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request to one page, prompt or date range and ask again.`
    : 'I reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request and ask again.';
}
/** Appended after a step's tool results, never deleted, so the cached history stays exact. */
function reminder(budget: Budget, ordinal: number, toolsUsed: number) {
  const left = budget.max_model_calls - ordinal;
  if (left === 1)
    return 'This is the last step of the turn: answer the user now from what you have read and name anything still missing. Tool calls will be refused.';
  const notes = [
    left <= budget.limit_reminder_calls ? `${left} steps are left in this turn.` : '',
    toolsUsed >= budget.max_tool_calls
      ? 'The read budget for this turn is spent: answer from what you have read.'
      : '',
  ].filter(Boolean);
  return notes.join(' ');
}
const ok = (outcome: ToolOutcome) =>
  outcome.status === 'completed' || outcome.status === 'unavailable';
const result = (call: ToolCall, text: string, error: boolean): ConversationBlock => ({
  type: 'tool_result',
  tool_use_id: call.id,
  content: text,
  ...(error ? { is_error: true } : {}),
});

/** Executes exactly one already-owned turn, fenced at every durable boundary. */
export class AgentRuntime {
  readonly db: Database;
  readonly deps: RuntimeDependencies;
  constructor(db: Database, deps: RuntimeDependencies) {
    this.db = db;
    this.deps = deps;
  }
  private load(lease: Lease) {
    return this.db.transaction().execute(async (trx) => {
      const run = await lockRun(trx, lease);
      const parsedBudget = budgetSchema.safeParse(run.budget);
      if (!parsedBudget.success) throw new AgentError('incompatible_budget');
      const budget = parsedBudget.data;
      if (!run.user_id) throw new AgentError('access_revoked');
      const scope = {
        workspaceId: run.workspace_id,
        projectId: run.project_id,
        userId: run.user_id,
      };
      await authorize(trx, scope);
      // A turn queued before the Agent changed is asked again, not misreported as a model fault.
      if (
        run.skill_catalog_version !== this.deps.catalog.version ||
        run.registry_version !== this.deps.tools.version ||
        run.protocol_version !== agentPolicy.protocol_version ||
        run.runtime_version !== agentPolicy.runtime_version
      )
        throw new AgentError('skills_changed');
      const chat = await getChat(trx, scope, run.chat_id, true);
      const current = await currentOutput(trx, chat);
      const request = await trx
        .selectFrom('agent_messages')
        .select('content')
        .where('workspace_id', '=', scope.workspaceId)
        .where('chat_id', '=', chat.id)
        .where('id', '=', run.user_message_id)
        .executeTakeFirstOrThrow();
      const manifest = manifestSchema.parse(run.context_manifest);
      return {
        run,
        scope,
        chat,
        current,
        // A revision keeps its predecessor's sources and adds this turn's reads.
        carried: revisionRefs(current.revision?.source_refs ?? []),
        request: request.content,
        manifest,
        // Fixed for the turn: computed once, not on every call.
        context: suppliedManifest(manifest, budget.context_package_max_chars),
        transcripts: await chatTranscripts(trx, scope, chat.id),
        budget,
      };
    });
  }
  /** `events` listens to this execution only; persisted state never depends on it. */
  async execute(lease: Lease, signal?: AbortSignal, events?: TurnEvents) {
    const latest: { summary?: PromptSummary } = {};
    try {
      await this.turn(lease, latest, signal, events);
    } catch (error) {
      // A stopped turn is ended by its caller; a lost lease by recovery.
      if (signal?.aborted) return;
      if (error instanceof AgentError && error.code === 'lease') return;
      // Provider failures were already retried within the call; the turn ends with its reply.
      await this.fail(lease, failureCode(error), latest.summary);
    }
  }
  private async turn(
    lease: Lease,
    latest: { summary?: PromptSummary },
    signal?: AbortSignal,
    events?: TurnEvents,
  ) {
    signal?.throwIfAborted();
    const turn = await this.load(lease);
    const { budget } = turn;
    const model = await this.deps.modelFor(turn.run);
    const { kept, dropped } = replayed(turn.transcripts, model.adapter, budget);
    const state = this.initialState(turn);
    const opening = openingMessage({
      kept,
      context: turn.context.text,
      revision: turn.current.revision,
      formatId: state.formatId,
      pinned: state.skill
        ? {
            skill: state.skill,
            text: methodology(this.deps.catalog, state.skill, state, budget),
          }
        : null,
      request: turn.request,
    });
    state.messages.push(opening.message);
    state.contextHash = opening.contextHash;
    latest.summary = {
      included_sections: turn.context.included,
      omissions: turn.context.omissions,
      replayed_turns: kept.length,
      dropped_turns: dropped,
    };
    const history = kept.flatMap((item) => item.messages);
    // The cached prefix: built once per turn from the catalog and the run's frozen bounds.
    const system = systemPrefix(this.deps.catalog);
    const tools = agentToolList(this.deps.tools, this.deps.catalog, budget);
    for (let ordinal = 1; ordinal <= budget.max_model_calls; ordinal++) {
      signal?.throwIfAborted();
      const request: ModelRequest = {
        system,
        tools,
        messages: [...history, ...state.messages],
        effort: budget.reasoning_effort,
        compactAtTokens: budget.compaction_trigger_tokens,
      };
      const response = await this.callModel(lease, ordinal, model, request, signal, events);
      // An empty assistant message would make every later replay of this chat invalid.
      const blocks = response.blocks.length
        ? response.blocks
        : [{ type: 'text', text: '(no answer)' }];
      state.messages.push({ role: 'assistant', content: blocks });
      state.steps.push({ kind: 'model', ordinal });
      if (!response.toolCalls.length)
        return this.finish(lease, turn, model, state, response.text, latest.summary);
      const last = ordinal === budget.max_model_calls;
      const results = await this.runTools(
        lease,
        turn,
        state,
        { ordinal, calls: response.toolCalls, last },
        signal,
        events,
      );
      const note = last ? '' : reminder(budget, ordinal, state.toolsUsed);
      state.messages.push({
        role: 'user',
        content: [...results, ...(note ? [{ type: 'text', text: note }] : [])],
      });
      // At the cap the final call's tool calls were refused; its text is the reply.
      if (last) return this.finish(lease, turn, model, state, response.text, latest.summary);
    }
    throw new AgentError('stopped_at_limit');
  }
  /** One model call, after rechecking that the workspace may still run the Agent. */
  private async callModel(
    lease: Lease,
    ordinal: number,
    model: AgentModel,
    request: ModelRequest,
    signal?: AbortSignal,
    events?: TurnEvents,
  ) {
    events?.step?.({ ordinal });
    const document = events?.document ? documentEmitter(ordinal, events.document) : undefined;
    const result = await this.deps.models.call(lease, ordinal, model, request, signal, {
      ...(events?.reply ? { text: (text: string) => events.reply?.({ ordinal, text }) } : {}),
      ...(events?.thinking
        ? { thinking: (text: string) => events.thinking?.({ ordinal, text }) }
        : {}),
      ...(document
        ? { toolInput: (name: string, input: unknown) => name === SAVE_DOCUMENT && document(input) }
        : {}),
    });
    signal?.throwIfAborted();
    // A cut-off answer cannot be repaired by asking again: the same request is cut again.
    if (result.stop === 'max_tokens') throw new AgentError('output_too_long');
    if (result.stop === 'refusal') throw new AgentError('model_refused');
    return result;
  }
  private initialState(turn: Turn): TurnState {
    const skill = this.deps.catalog.skills.get(
      turn.run.requested_skill_id ?? turn.current.output?.skill_id ?? '',
    );
    if (turn.run.requested_skill_id && !skill) throw new AgentError('skills_changed');
    return {
      skill,
      skillSource: turn.run.requested_skill_source ?? (skill ? 'chat' : null),
      outputKind: turn.current.output?.kind ?? null,
      outlineApproved: turn.current.outlineApproved,
      formatId: currentFormat(turn),
      staged: null,
      read: [],
      steps: [],
      toolsUsed: 0,
      messages: [],
      contextHash: '',
    };
  }
  /**
   * One response's tool calls. Built-ins run first, in the order written, since
   * they change the turn's state; reads then run concurrently, each recorded as
   * its own attempt. Every call gets a result the model reads, in call order.
   */
  private async runTools(
    lease: Lease,
    turn: Turn,
    state: TurnState,
    { ordinal, calls, last }: { ordinal: number; calls: ToolCall[]; last: boolean },
    signal?: AbortSignal,
    events?: TurnEvents,
  ) {
    let saved = false;
    let parallel = 0;
    const pending = calls.map((call, index) => {
      const callId = (call.id || `call_${index}`).slice(0, 64);
      const tool = (status: Parameters<NonNullable<TurnEvents['tool']>>[0]['status']) =>
        events?.tool?.({ ordinal, call_id: callId, tool: call.name, status });
      tool('started');
      if (last) {
        tool('refused');
        return Promise.resolve(
          result(call, 'The turn has reached its last step. Answer without this call.', true),
        );
      }
      if (isBuiltin(call.name)) {
        const outcome = this.builtin(turn, state, call, saved);
        if (call.name === SAVE_DOCUMENT && outcome.ok) saved = true;
        tool(outcome.ok ? 'completed' : 'refused');
        return Promise.resolve(result(call, outcome.text, !outcome.ok));
      }
      let limit: ToolOutcome | null = null;
      if (state.toolsUsed >= turn.budget.max_tool_calls)
        limit = refused(
          'tool_budget_spent',
          'The read budget for this turn is spent. Answer from what you have read.',
        );
      else if (parallel >= turn.budget.max_parallel_tool_calls)
        limit = refused(
          'parallel_limit',
          `At most ${turn.budget.max_parallel_tool_calls} reads run in one step. Make this call in your next step.`,
        );
      if (!limit && this.deps.tools.has(call.name)) {
        state.toolsUsed++;
        parallel++;
      }
      return this.read(lease, turn, state, ordinal, { ...call, id: callId }, limit, signal).then(
        (outcome) => {
          tool(outcome.status);
          return result(call, outcome.text, !ok(outcome));
        },
      );
    });
    return Promise.all(pending);
  }
  private builtin(turn: Turn, state: TurnState, call: ToolCall, saved: boolean) {
    const { catalog } = this.deps;
    if (call.name === LOAD_SKILL) {
      const before = state.skill;
      const outcome = loadSkill(catalog, state, call.input, turn.budget);
      if (outcome.ok && !before && state.skill)
        state.steps.push({ kind: 'skill', skill_id: state.skill.id });
      return outcome;
    }
    // One document per response, so completion order never picks the winner.
    if (saved)
      return {
        ok: false,
        text: 'Save one document per step. The first save in this step was kept.',
      };
    const outcome = saveDocument(catalog, state, call.input, turn.budget);
    if (outcome.ok) state.steps.push({ kind: 'document' });
    return outcome;
  }
  private async read(
    lease: Lease,
    turn: Turn,
    state: TurnState,
    ordinal: number,
    call: ToolCall,
    limit: ToolOutcome | null,
    signal?: AbortSignal,
  ) {
    const started = performance.now();
    // The model receipt just rechecked the lease; the result is fenced again on record.
    const outcome =
      limit ??
      (await this.deps.tools.execute(
        this.db,
        turn.scope,
        call.name,
        call.input,
        leaseSignal(AbortSignal.timeout(turn.budget.execution_timeout_seconds * 1000), signal),
        turn.budget.tool_result_max_chars,
      ));
    await this.recordTool(
      lease,
      turn.scope,
      ordinal,
      call,
      outcome,
      Math.round(performance.now() - started),
    );
    state.steps.push({
      kind: 'tool',
      ordinal,
      tool: call.name,
      status: outcome.status,
      call_id: call.id,
    });
    state.read.push(...readSources(outcome.refs));
    return outcome;
  }
  private recordTool(
    lease: Lease,
    scope: Scope,
    ordinal: number,
    call: ToolCall,
    outcome: ToolOutcome,
    latency: number,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await lockRun(trx, lease);
      await authorize(trx, scope);
      await trx
        .insertInto('agent_tool_attempts')
        .values({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          run_id: lease.runId,
          run_attempt: lease.attempt,
          ordinal,
          call_id: call.id,
          tool_name: call.name.slice(0, 128),
          registry_version: this.deps.tools.version,
          status: outcome.status,
          input: JSON.stringify(call.input),
          artifact_refs: JSON.stringify(outcome.refs),
          omissions: JSON.stringify(outcome.omissions),
          output_hash: outcome.hash,
          error_code: outcome.error.slice(0, 64),
          latency_ms: latency,
          created_at: new Date(),
        })
        .execute();
    });
  }
  /** The reply, the staged document and the transcript commit together, or not at all. */
  private finish(
    lease: Lease,
    turn: Turn,
    model: AgentModel,
    state: TurnState,
    text: string,
    summary: PromptSummary | undefined,
  ) {
    const { skill, skillSource: source, read, steps, staged } = state;
    const { budget } = turn;
    const reads = steps.filter((step) => step.kind === 'tool' && step.status === 'completed');
    return this.db.transaction().execute(async (trx) => {
      const run = await lockRun(trx, lease);
      await authorize(trx, turn.scope);
      const chat = await getChat(trx, turn.scope, run.chat_id, true);
      const sources = uniqueSources(contextCitations(turn.manifest), read);
      const document = staged && skill ? staged : null;
      const formatLabel = document?.format_id
        ? (this.deps.catalog.formats?.get(document.format_id)?.label ?? document.format_id)
        : null;
      const completion = document ? savedNotice(document.phase, formatLabel) : '';
      const reply = scrubRecordRefs(text).trim();
      let content = completion;
      if (reply) {
        const answer = bounded(
          reply,
          budget.reply_max_chars - completion.length - 2,
          '\n[reply truncated at its size bound]',
        );
        content = [answer, completion].filter(Boolean).join('\n\n');
      } else if (!document) content = noReply(reads.length);
      const message = await appendMessage(trx, chat, {
        role: 'agent',
        replyTo: run.user_message_id,
        content,
        evidence: sources,
        steps,
        skillId: skill?.id,
        skillSource: source,
      });
      if (document && skill)
        await saveAgentOutput(
          trx,
          chat,
          {
            skill,
            bounds: budget,
            payload: document,
            baseRevisionId: turn.current.revision?.id ?? null,
            runId: run.id,
            messageId: message.id,
            userId: turn.scope.userId,
            refs: uniqueSources(turn.carried, sources),
            outlineRequired: outlineRequired(this.deps.catalog, skill, document.format_id),
          },
          this.deps.attachTarget,
        );
      await saveTranscript(trx, {
        scope: turn.scope,
        runId: run.id,
        chatId: chat.id,
        adapter: model.adapter,
        model: model.model,
        skillId: skill?.id ?? null,
        contextHash: state.contextHash,
        messages: state.messages,
      });
      await trx
        .updateTable('agent_runs')
        .set({
          skill_id: skill?.id ?? null,
          skill_source: source,
          skill_version: skill?.version ?? null,
          ...(summary ? withSummary(summary) : {}),
        })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      await touchChat(trx, chat.workspace_id, chat.id);
      await terminalize(trx, lease, 'succeeded');
    });
  }
  /** Ends the turn with its code-specific reply, settling any open model attempt. */
  async fail(lease: Lease, code: string, summary?: PromptSummary) {
    try {
      await this.db.transaction().execute(async (trx) => {
        const run = await lockRun(trx, lease);
        await this.deps.models.reconcile(trx, run);
        if (run.user_id && code !== 'access_revoked') {
          await authorize(trx, {
            workspaceId: run.workspace_id,
            projectId: run.project_id,
            userId: run.user_id,
          });
          if (summary)
            await trx
              .updateTable('agent_runs')
              .set(withSummary(summary))
              .where('id', '=', run.id)
              .where('workspace_id', '=', run.workspace_id)
              .execute();
          await appendRecoveryReply(trx, run, code);
        }
        await terminalize(trx, lease, 'failed', code);
      });
    } catch (error) {
      if (!(error instanceof AgentError && error.code === 'lease')) throw error;
    }
  }
}
