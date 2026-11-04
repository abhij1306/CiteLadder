import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { ModelError } from '../models/http.ts';
import {
  hasPendingServerTool,
  webSearchBlocks,
  type ServerToolEvent,
  type ConversationBlock,
  type ConversationMessage,
  type ToolCall,
} from '../models/conversation.ts';
import { authorize } from './access.ts';
import {
  isBuiltin,
  agentToolList,
  documentLabel,
  editDocument,
  loadSkill,
  methodology,
  saveDocument,
  EDIT_DOCUMENT,
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
import { ModelCalls, RefusedDispatch, type AgentModel, type ModelRequest } from './model-calls.ts';
import {
  chatDocuments,
  latestDocument,
  revisionRefs,
  revisionWebSources,
  saveAgentOutput,
  type AttachTarget,
} from './outputs.ts';
import { lockRun, terminalize } from './queue.ts';
import { appendMessage, appendRecoveryReply, getChat, touchChat } from './messages.ts';
import { readSources, scrubRecordRefs, uniqueSources, uniqueWeb } from './sources.ts';
import { documentEmitter, type TurnEvents } from './stream.ts';
import {
  chatTranscripts,
  lastResponseId,
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
  kind: 'model' | 'skill' | 'document' | 'tool' | 'search';
  ordinal?: number;
  skill_id?: string;
  tool?: string;
  status?: string;
  call_id?: string;
  /** A web search's query, as the model wrote it. */
  query?: string;
};
type PromptSummary = Record<string, Json>;
type TurnState = DocumentState & {
  /** Records this turn's reads returned: the reply's sources. */
  read: string[];
  /** Web pages this turn's searches returned, by URL: sources apart from CiteLadder records. */
  web: Map<string, string>;
  /** Each web search's query by call id, until its result arrives. */
  queries: Map<string, string>;
  /** Web searches the provider ran this turn, discarded responses included. */
  searches: number;
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
/** The workflow's pinned format, else the latest document's. */
function currentFormat(turn: Turn) {
  return turn.manifest.workflow?.format_id ?? turn.latest?.output.format_id ?? null;
}
/** Merges the last prompt summary into the frozen manifest without rewriting it. */
function withSummary(summary: PromptSummary) {
  return {
    context_manifest: sql<Json>`context_manifest || jsonb_build_object('prompt_summary', ${JSON.stringify(summary)}::jsonb)`,
  };
}
function savedNotice(number: number, formatLabel: string | null) {
  const format = formatLabel ? ` in ${formatLabel} format` : '';
  return `${documentLabel(number)} saved${format}.`;
}
/**
 * The web searches the next call may run, and is held for: what is left of the
 * turn's budget, at most the per-call cap. None left offers no search tool. A
 * search the previous response left waiting (beside a read, or paused) runs
 * in the next call, which must offer the tool, so at least one is offered then.
 * The last call starts no new search: one left waiting there could never run.
 */
function searchAllowance(budget: Budget, used: number, waiting: boolean, last: boolean) {
  const left = last ? 0 : Math.max(0, budget.max_web_searches - used);
  const allowed = Math.min(left, budget.max_web_searches_per_call);
  return waiting ? Math.max(1, allowed) : allowed;
}
/**
 * Thinking shares the output cap, so a cut-off call is discarded and asked
 * once more with low effort as the next call of the turn; a cut-off retry, or
 * a cut-off last call, ends the turn.
 */
function retryEffort(effort: Budget['reasoning_effort'], ordinal: number, budget: Budget) {
  if (effort === 'low' || ordinal === budget.max_model_calls)
    throw new AgentError('output_too_long');
  return 'low' as const;
}
/** A turn never ends without a reply, even when the model wrote none. */
function noReply(reads: number) {
  const read = reads === 1 ? 'one read' : `${reads} reads`;
  return reads
    ? `I completed ${read} but reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request to one page, prompt or date range and ask again.`
    : 'I reached this turn’s limit before writing an answer. Nothing was saved. Narrow the request and ask again.';
}
const UNFUNDED_REPLY = 'The Agent model connection changed before I could write a summary.';
const unfunded = (error: unknown) => error instanceof RefusedDispatch;
/** Appended after a step's tool results, never deleted, so the cached history stays exact. */
function reminder(
  budget: Budget,
  ordinal: number,
  state: Pick<TurnState, 'toolsUsed' | 'searches'>,
) {
  const left = budget.max_model_calls - ordinal;
  if (left === 1)
    return 'This is the last step of the turn: answer now from what you have read and name anything still missing. Tool calls will be refused.';
  const notes = [
    left <= budget.limit_reminder_calls ? `${left} steps are left in this turn.` : '',
    state.toolsUsed >= budget.max_tool_calls
      ? 'The read budget for this turn is spent: answer from what you have read.'
      : '',
    budget.max_web_searches > 0 && state.searches >= budget.max_web_searches
      ? 'The web search budget for this turn is spent.'
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
      const documents = await chatDocuments(trx, chat);
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
        documents,
        latest: latestDocument(documents),
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
      documents: turn.documents.map(({ output, revision }) => ({
        number: output.number,
        kind: output.kind,
        formatId: output.format_id,
        revision,
      })),
      pinned: state.skill
        ? {
            skill: state.skill,
            text: methodology(state.skill, state, budget),
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
    let effort = budget.reasoning_effort;
    const lastKept = kept.at(-1);
    let previousResponseId = lastKept
      ? await lastResponseId(this.db, turn.scope, lastKept.runId)
      : null;
    // Provider-hosted search exists only on the Messages API.
    const searchable = model.adapter === 'anthropic';
    let waiting = false;
    for (let ordinal = 1; ordinal <= budget.max_model_calls; ordinal++) {
      signal?.throwIfAborted();
      const request: ModelRequest = {
        system,
        tools,
        messages: [...history, ...state.messages],
        effort,
        compactAtTokens: budget.compaction_trigger_tokens,
        previousResponseId,
        webSearches: searchable
          ? searchAllowance(budget, state.searches, waiting, ordinal === budget.max_model_calls)
          : 0,
      };
      let response;
      try {
        response = await this.callModel(lease, ordinal, model, request, signal, events);
      } catch (error) {
        // Finished work is kept: a document already staged commits with a fixed reply.
        if (unfunded(error) && state.staged.size && !waiting)
          return this.finish(lease, turn, model, state, UNFUNDED_REPLY, latest.summary, true);
        throw error;
      }
      previousResponseId = response.response_id || previousResponseId;
      // A discarded response's searches were still run and billed.
      const reported = response.usage.web_search_requests;
      state.searches +=
        typeof reported === 'number' ? reported : webSearchBlocks(response.blocks).calls.length;
      if (response.stop === 'max_tokens') {
        effort = retryEffort(effort, ordinal, budget);
        continue;
      }
      effort = budget.reasoning_effort;
      // An empty assistant message would make every later replay of this chat invalid.
      const blocks = response.blocks.length
        ? response.blocks
        : [{ type: 'text', text: '(no answer)' }];
      state.messages.push({ role: 'assistant', content: blocks });
      state.steps.push({ kind: 'model', ordinal });
      this.searched(state, ordinal, blocks);
      const last = ordinal === budget.max_model_calls;
      // A paused search loop continues from the unchanged response in the next call.
      waiting = response.stop === 'pause_turn' || hasPendingServerTool(blocks);
      if (response.stop === 'pause_turn') {
        if (last) return this.finish(lease, turn, model, state, response.text, latest.summary);
        continue;
      }
      if (!response.toolCalls.length)
        return this.finish(lease, turn, model, state, response.text, latest.summary);
      const results = await this.runTools(
        lease,
        turn,
        state,
        { ordinal, calls: response.toolCalls, last },
        signal,
        events,
      );
      // A search waiting on these results needs a message of results only.
      const note = last || waiting ? '' : reminder(budget, ordinal, state);
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
      ...(events?.tool
        ? {
            serverTool: ({ id, name, status }: ServerToolEvent) =>
              events.tool?.({ ordinal, call_id: id.slice(0, 64), tool: name, status }),
          }
        : {}),
    });
    signal?.throwIfAborted();
    // Neither is repaired by asking again: the same input is too long or refused again.
    if (result.stop === 'context_window') throw new AgentError('context_too_long');
    if (result.stop === 'refusal') throw new AgentError('model_refused');
    return result;
  }
  private initialState(turn: Turn): TurnState {
    const skill = this.deps.catalog.skills.get(
      turn.run.requested_skill_id ?? turn.latest?.output.skill_id ?? '',
    );
    if (turn.run.requested_skill_id && !skill) throw new AgentError('skills_changed');
    return {
      skill,
      skillSource: turn.run.requested_skill_source ?? (skill ? 'chat' : null),
      formatId: currentFormat(turn),
      documents: turn.documents.map(({ output, revision }) => ({
        number: output.number,
        kind: output.kind,
        skillId: output.skill_id,
        formatId: output.format_id,
        title: revision.title,
        body: revision.body,
      })),
      staged: new Map(),
      read: [],
      web: new Map(),
      queries: new Map(),
      searches: 0,
      steps: [],
      toolsUsed: 0,
      messages: [],
      contextHash: '',
    };
  }
  /** Records one response's web searches: a step per result, and the pages each returned. */
  private searched(state: TurnState, ordinal: number, blocks: ConversationBlock[]) {
    const { calls, results } = webSearchBlocks(blocks);
    for (const call of calls) state.queries.set(call.id, call.query);
    for (const { callId, sources } of results) {
      state.steps.push({
        kind: 'search',
        ordinal,
        status: sources ? 'completed' : 'failed',
        call_id: callId.slice(0, 64),
        query: (state.queries.get(callId) ?? '').slice(0, 200),
      });
      for (const source of sources ?? [])
        if (!state.web.has(source.url)) state.web.set(source.url, source.title);
    }
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
    const saved = new Set<number>();
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
        if (call.name === SAVE_DOCUMENT && outcome.ok && outcome.document)
          saved.add(outcome.document);
        // An edit's input is not the document, so the edited text is shown once applied.
        const edited = outcome.document ? state.staged.get(outcome.document) : undefined;
        if (call.name === EDIT_DOCUMENT && outcome.ok && edited)
          events?.document?.({ ordinal, title: edited.payload.title, body: edited.payload.body });
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
  private builtin(turn: Turn, state: TurnState, call: ToolCall, saved: ReadonlySet<number>) {
    const { catalog } = this.deps;
    if (call.name === LOAD_SKILL) {
      const before = state.skill;
      const outcome = loadSkill(catalog, state, call.input, turn.budget);
      if (outcome.ok && state.skill && before?.id !== state.skill.id)
        state.steps.push({ kind: 'skill', skill_id: state.skill.id });
      return outcome;
    }
    // A document is saved whole once per response, so a later save never silently wins.
    const outcome =
      call.name === EDIT_DOCUMENT
        ? editDocument(catalog, state, call.input, turn.budget)
        : saveDocument(catalog, state, call.input, turn.budget, saved);
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
  /**
   * The reply, the staged document and the transcript commit together, or not
   * at all. A `closing` reply is one the model did not write; it ends the
   * transcript as its answer, so a later turn replays a well-formed chat.
   */
  private finish(
    lease: Lease,
    turn: Turn,
    model: AgentModel,
    state: TurnState,
    text: string,
    summary: PromptSummary | undefined,
    closing = false,
  ) {
    if (closing) state.messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
    const { skill, skillSource: source, read, steps } = state;
    const { budget } = turn;
    const reads = steps.filter((step) => step.kind === 'tool' && step.status === 'completed');
    const staged = [...state.staged].toSorted(([left], [right]) => left - right);
    const web = [...state.web].map(([url, title]) => ({ url, title }));
    return this.db.transaction().execute(async (trx) => {
      const run = await lockRun(trx, lease);
      await authorize(trx, turn.scope);
      const chat = await getChat(trx, turn.scope, run.chat_id, true);
      const sources = uniqueSources(contextCitations(turn.manifest), read);
      const completion = staged
        .map(([number, { payload }]) => {
          const format = payload.format_id;
          const label = format ? (this.deps.catalog.formats?.get(format)?.label ?? format) : null;
          return savedNotice(number, label);
        })
        .join(' ');
      const reply = scrubRecordRefs(text).trim();
      let content = completion;
      if (reply) {
        const answer = bounded(
          reply,
          budget.reply_max_chars - completion.length - 2,
          '\n[reply truncated at its size bound]',
        );
        content = [answer, completion].filter(Boolean).join('\n\n');
      } else if (!staged.length) content = noReply(reads.length);
      const message = await appendMessage(trx, chat, {
        role: 'agent',
        replyTo: run.user_message_id,
        content,
        evidence: sources,
        webSources: web,
        steps,
        skillId: skill?.id,
        skillSource: source,
      });
      for (const [number, document] of staged) {
        const saved = turn.documents.find(({ output }) => output.number === number);
        // A revision keeps its predecessor's sources and adds this turn's.
        await saveAgentOutput(
          trx,
          chat,
          {
            number,
            kind: document.kind,
            skillId: document.skillId,
            bounds: budget,
            payload: document.payload,
            baseRevisionId: saved?.revision.id ?? null,
            runId: run.id,
            messageId: message.id,
            userId: turn.scope.userId,
            refs: uniqueSources(revisionRefs(saved?.revision.source_refs ?? []), sources),
            webSources: uniqueWeb(revisionWebSources(saved?.revision.web_sources ?? []), web),
          },
          this.deps.attachTarget,
        );
      }
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
  /**
   * Ends the turn with its code-specific reply. A failed turn saves nothing,
   * so its model calls are settled and then refunded.
   */
  async fail(lease: Lease, code: string, summary?: PromptSummary) {
    try {
      await this.db.transaction().execute(async (trx) => {
        const run = await lockRun(trx, lease);
        await this.deps.models.settleFailed(trx, run);
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
