import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import {
  type ServerToolEvent,
  type ConversationBlock,
  type ToolCall,
} from '../models/conversation.ts';
import { authorize } from './access.ts';
import {
  isBuiltin,
  agentToolList,
  editDocument,
  loadSkill,
  methodology,
  saveDocument,
  suggestEdits,
  EDIT_DOCUMENT,
  LOAD_SKILL,
  SAVE_DOCUMENT,
  SUGGEST_EDITS,
} from './builtin-tools.ts';
import { offeredRuleIds } from '../page-documents/content-rules.ts';
import { pageStates, saveSuggestions } from './suggest-edits.ts';
import {
  agentPolicy,
  AgentError,
  budgetSchema,
  type Lease,
  type Scope,
  type SkillCatalog,
} from './contracts.ts';
import { manifestSchema, suppliedManifest } from './context.ts';
import { ModelCalls, type AgentModel, type ModelRequest } from './model-calls.ts';
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
import { readSources, scrubRecordRefs, uniqueSources, uniqueWeb, writtenIds } from './sources.ts';
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
import { logLaneFailure } from '../queue/lane-log.ts';
import { AGENT_LANE } from '../queue/task-queue.ts';
import { ToolRegistry, type ToolOutcome } from './tools.ts';
import {
  nextSearches,
  noReply,
  readLimit,
  resultsMessage,
  retryEffort,
  type TurnState,
} from './turn-budget.ts';
import {
  bounded,
  closable,
  CLOSED_REPLY,
  failureCode,
  savedNotice,
  savedTranscript,
  stillAuthorized,
  suggestedNotices,
  UNAVAILABLE_REPLY,
  unlessClosable,
  withSummary,
  type PromptSummary,
  type StoppedTurn,
} from './turn-ending.ts';
import { accepted, initialState, pageDocuments, reportedSearches } from './turn-state.ts';

export type RuntimeDependencies = {
  catalog: SkillCatalog;
  tools: ToolRegistry;
  models: ModelCalls;
  modelFor: (run: Awaited<ReturnType<typeof lockRun>>) => AgentModel | Promise<AgentModel>;
  attachTarget: AttachTarget;
};
export type Turn = Awaited<ReturnType<AgentRuntime['load']>>;
/** What the turn had built when it stopped. */
type Progress = {
  summary?: PromptSummary;
  open?: { turn: Turn; model: AgentModel; state: TurnState };
};
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
      // The chat's turn limit bounds its messages.
      const written = await trx
        .selectFrom('agent_messages')
        .select('content')
        .where('workspace_id', '=', scope.workspaceId)
        .where('chat_id', '=', chat.id)
        .where('role', '=', 'user')
        .execute();
      const manifest = manifestSchema.parse(run.context_manifest);
      return {
        run,
        scope,
        chat,
        documents,
        latest: latestDocument(documents),
        request: request.content,
        personIds: writtenIds(
          ...written.map((message) => message.content),
          ...documents.flatMap(({ revision }) => [revision.title, revision.body]),
        ),
        manifest,
        pages: await pageStates(trx, scope.workspaceId, pageDocuments(documents)),
        // The content rules this turn's context offered; suggest_edits accepts only these.
        rules: offeredRuleIds({ sections: manifest.package.sections, action: manifest.action }),
        // Fixed for the turn: computed once, not on every call.
        context: suppliedManifest(manifest, budget.context_package_max_chars),
        transcripts: await chatTranscripts(trx, scope, chat.id),
        budget,
      };
    });
  }
  /**
   * `events` listens to this execution only; persisted state never depends on it.
   * A stopped turn is left for its caller to end, with the documents it staged
   * when it can still save them.
   */
  async execute(
    lease: Lease,
    signal?: AbortSignal,
    events?: TurnEvents,
  ): Promise<StoppedTurn | undefined> {
    const latest: Progress = {};
    const startedAt = performance.now();
    try {
      await this.turn(lease, latest, signal, events);
    } catch (error) {
      // A stopped turn is ended by its caller; a lost lease by recovery.
      if (signal?.aborted) return this.stopped(lease, latest);
      if (error instanceof AgentError && error.code === 'lease') return undefined;
      // Provider failures were already retried within the call; the turn ends with its reply.
      const code = failureCode(error);
      logLaneFailure(
        AGENT_LANE.table,
        { id: lease.runId, workspace_id: lease.workspaceId, attempt_count: lease.attempt },
        { phase: 'turn', startedAt, outcome: 'failed', error, code },
      );
      await this.fail(lease, code, latest.summary);
    }
    return undefined;
  }
  /**
   * A stopped turn that staged a document saves it with a fixed reply and is
   * completed (B69); without one, or when it cannot be saved, it ends interrupted.
   */
  private stopped(lease: Lease, { open, summary }: Progress): StoppedTurn | undefined {
    if (!open || !closable(open.state)) return undefined;
    return {
      saveDocuments: async () => {
        try {
          await this.finish(lease, open.turn, open.model, open.state, CLOSED_REPLY, summary, true);
        } catch (error) {
          if (error instanceof AgentError && error.code === 'lease') return;
          await this.fail(lease, 'interrupted', summary);
        }
      },
    };
  }
  /** The turn's state with its opening message, and the earlier turns it replays. */
  private opened(turn: Turn, model: AgentModel, latest: Progress) {
    const { budget } = turn;
    const { kept, dropped } = replayed(turn.transcripts, model.adapter, budget);
    const state = initialState(this.deps.catalog, turn);
    latest.open = { turn, model, state };
    const opening = openingMessage({
      kept,
      context: turn.context.text,
      documents: turn.documents.map(({ output, revision }) => ({
        number: output.number,
        kind: output.kind,
        formatId: output.format_id,
        revision,
        suggestions: turn.pages.get(output.number)?.digest ?? null,
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
    return { state, kept };
  }
  /** The last replayed turn's final response, which the first call continues. */
  private async replayedResponseId(turn: Turn, kept: ReturnType<typeof replayed>['kept']) {
    const lastKept = kept.at(-1);
    return lastKept ? lastResponseId(this.db, turn.scope, lastKept.runId) : null;
  }
  private async turn(lease: Lease, latest: Progress, signal?: AbortSignal, events?: TurnEvents) {
    signal?.throwIfAborted();
    const turn = await this.load(lease);
    const { budget } = turn;
    const model = await this.deps.modelFor(turn.run);
    const { state, kept } = this.opened(turn, model, latest);
    const history = kept.flatMap((item) => item.messages);
    // The cached prefix: built once per turn from the catalog and the run's frozen bounds.
    const system = systemPrefix(this.deps.catalog);
    const tools = agentToolList(this.deps.tools, this.deps.catalog, budget);
    let effort = budget.reasoning_effort;
    let previousResponseId = await this.replayedResponseId(turn, kept);
    for (let ordinal = 1; ordinal <= budget.max_model_calls; ordinal++) {
      signal?.throwIfAborted();
      const request: ModelRequest = {
        system,
        tools,
        messages: [...history, ...state.messages],
        effort,
        compactAtTokens: budget.compaction_trigger_tokens,
        previousResponseId,
        webSearches: nextSearches(model, budget, state, ordinal),
      };
      const response = await this.callModel(lease, ordinal, model, request, signal, events).catch(
        unlessClosable(state),
      );
      // Finished work is kept: a document already staged commits with a fixed reply (B60).
      if (!response)
        return this.finish(lease, turn, model, state, UNAVAILABLE_REPLY, latest.summary, true);
      previousResponseId = response.response_id || previousResponseId;
      // A discarded response's searches were still run, so they count against the turn's budget.
      state.searches += reportedSearches(response);
      if (response.stop === 'max_tokens') {
        effort = retryEffort(effort, ordinal, budget);
        continue;
      }
      effort = budget.reasoning_effort;
      accepted(state, ordinal, response);
      const last = ordinal === budget.max_model_calls;
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
      state.messages.push(resultsMessage(budget, state, { ordinal, last, results }));
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
      const limit = readLimit(turn.budget, state.toolsUsed, parallel);
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
    if (call.name === SUGGEST_EDITS) {
      const outcome = suggestEdits(catalog, state, call.input, turn.budget);
      if (outcome.ok) state.steps.push({ kind: 'suggestion' });
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
    state.read.push(...readSources(outcome.received));
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
      const sources = uniqueSources(turn.context.citations, read);
      const completion = [
        ...staged.map(([number, { payload }]) => {
          const format = payload.format_id;
          const label = format ? (this.deps.catalog.formats?.get(format)?.label ?? format) : null;
          return savedNotice(number, label);
        }),
        ...suggestedNotices(state.suggestions),
      ].join(' ');
      const reply = scrubRecordRefs(text, state.personIds).trim();
      let content = completion;
      if (reply) {
        const answer = bounded(
          reply,
          budget.reply_max_chars - completion.length - 2,
          '\n[reply truncated at its size bound]',
        );
        content = [answer, completion].filter(Boolean).join('\n\n');
      } else if (!completion) content = noReply(reads.length);
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
      // Suggestions anchor to each page's latest revision, so they follow the documents.
      await saveSuggestions(trx, chat, state.suggestions, {
        runId: run.id,
        messageId: message.id,
        outputs: new Map(turn.documents.map(({ output }) => [output.number, output.id])),
      });
      await saveTranscript(trx, {
        scope: turn.scope,
        runId: run.id,
        chatId: chat.id,
        adapter: model.adapter,
        model: model.model,
        skillId: skill?.id ?? null,
        contextHash: state.contextHash,
        messages: savedTranscript(state.messages),
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
   * so its unanswered model calls are closed first. A member who lost
   * access gets no summary or reply, but the turn still ends.
   */
  async fail(lease: Lease, code: string, summary?: PromptSummary) {
    try {
      await this.db.transaction().execute(async (trx) => {
        const run = await lockRun(trx, lease);
        await this.deps.models.reconcile(trx, run);
        if (
          run.user_id &&
          code !== 'access_revoked' &&
          (await stillAuthorized(trx, {
            workspaceId: run.workspace_id,
            projectId: run.project_id,
            userId: run.user_id,
          }))
        ) {
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
