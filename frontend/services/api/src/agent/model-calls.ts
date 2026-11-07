import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import {
  conversationInputBytes,
  type ConversationListener,
  type ConversationRequest,
  type ConversationResult,
} from '../models/conversation.ts';
import { ModelError } from '../models/http.ts';
import { authorize } from './access.ts';
import { abortable } from './async.ts';
import { AgentError, budgetSchema, type Lease, type Run } from './contracts.ts';
import { lockRun } from './queue.ts';

export type ModelResult = ConversationResult;
export type ModelRequest = ConversationRequest;
type Usage = ModelResult['usage'];
export type AgentModel = {
  adapter: string;
  endpointHost: string;
  model: string;
  /** `listener` sees text, thinking and tool input as they stream; display only. */
  converse: (
    request: ModelRequest,
    signal: AbortSignal,
    listener?: ConversationListener,
  ) => Promise<ModelResult>;
};
/**
 * The dispatch recheck, inside the dispatch transaction: throws when the
 * run's frozen model is no longer the configured one (`model_changed`) or no
 * model is configured (`model_unavailable`).
 */
export type ModelAvailability = (run: Run) => void;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/**
 * A dispatch refused because no model is available, before anything was
 * recorded or sent: the turn may still end with work it already staged.
 */
export class RefusedDispatch extends AgentError {
  constructor() {
    super('model_unavailable');
  }
}
export class ModelCalls {
  readonly db: Database;
  readonly available: ModelAvailability;
  constructor(db: Database, available: ModelAvailability) {
    this.db = db;
    this.available = available;
  }
  dispatch(lease: Lease, ordinal: number, model: AgentModel, request: ModelRequest) {
    return this.db.transaction().execute(async (trx) => {
      const run = await lockRun(trx, lease);
      if (!run.user_id) throw new AgentError('access_revoked');
      await authorize(trx, {
        workspaceId: run.workspace_id,
        projectId: run.project_id,
        userId: run.user_id,
      });
      const budget = budgetSchema.parse(run.budget);
      if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > budget.max_model_calls)
        throw new AgentError('stopped_at_limit');
      if (run.requested_model !== model.model) throw new AgentError('model_changed');
      const existing = await trx
        .selectFrom('agent_model_attempts')
        .select('id')
        .where('workspace_id', '=', run.workspace_id)
        .where('run_id', '=', run.id)
        .where('run_attempt', '=', run.attempt_count)
        .where('ordinal', '=', ordinal)
        .executeTakeFirst();
      if (existing) throw new AgentError('lease');
      this.available(run);
      const now = new Date();
      const attempt = await trx
        .insertInto('agent_model_attempts')
        .values({
          id: randomUUID(),
          workspace_id: run.workspace_id,
          project_id: run.project_id,
          run_id: run.id,
          dispatch_id: randomUUID(),
          run_attempt: run.attempt_count,
          ordinal,
          provider_adapter: model.adapter,
          endpoint_host: model.endpointHost,
          requested_model: run.requested_model,
          returned_model: '',
          // The size of what the provider read, and the output cap sent (null: the route's).
          input_bytes: conversationInputBytes(request),
          max_output_tokens: request.maxOutputTokens ?? null,
          input_tokens: null,
          cached_input_tokens: null,
          cache_write_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
          total_tokens: null,
          usage_complete: false,
          request_hash: hash(JSON.stringify(request)),
          output_hash: '',
          dispatched_at: now,
          deadline_at: new Date(now.getTime() + budget.execution_timeout_seconds * 1000),
          settled_at: null,
          outcome: 'dispatched',
          error_code: '',
          finish_status: '',
          late_receipt: false,
          latency_ms: null,
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('agent_runs')
        .set({ steps_used: sql<number>`greatest(steps_used, ${ordinal})` })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      return attempt;
    });
  }
  /** Recording a receipt outlives cancellation/lease loss; the first receipt wins. */
  receipt(
    workspaceId: string,
    attemptId: string,
    result: ModelResult | null,
    /** Tokens a failed call still reported, recorded with its receipt. */
    failedUsage: Usage | null = null,
  ) {
    const outcome = result ? 'completed' : 'failed';
    const reported = result?.usage ?? failedUsage;
    return this.db.transaction().execute(async (trx) => {
      const attempt = await trx
        .selectFrom('agent_model_attempts')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', attemptId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (attempt.outcome !== 'dispatched') return;
      const usage = (name: string) => {
        const value = reported?.[name];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? value
          : null;
      };
      const now = new Date();
      await trx
        .updateTable('agent_model_attempts')
        .set({
          input_tokens: usage('input_tokens'),
          output_tokens: usage('output_tokens'),
          cached_input_tokens: usage('cached_input_tokens'),
          cache_write_input_tokens: usage('cache_write_input_tokens'),
          reasoning_tokens: usage('reasoning_tokens'),
          total_tokens: usage('total_tokens'),
          usage_complete: usage('input_tokens') !== null && usage('output_tokens') !== null,
          outcome,
          settled_at: now,
          late_receipt: now > attempt.deadline_at,
          returned_model: result?.returned_model.slice(0, 255) ?? '',
          finish_status: result?.finish_status.slice(0, 64) ?? '',
          output_hash: result ? hash(JSON.stringify(result.blocks)) : '',
          error_code: result ? '' : 'provider_error',
          latency_ms: result?.latency_ms ?? null,
          // How this call used the prompt cache, for cost and cache analysis.
          response_id: result?.response_id.slice(0, 128) ?? '',
          cache_write_1h_input_tokens: usage('cache_write_1h_input_tokens'),
          web_search_requests: usage('web_search_requests'),
          cache_miss_reason: result?.cache.reason ?? '',
          cache_missed_input_tokens:
            result && 'missed_input_tokens' in result.cache
              ? result.cache.missed_input_tokens
              : null,
          usage_iterations: JSON.stringify(result?.iterations ?? []),
        })
        .where('id', '=', attempt.id)
        .where('workspace_id', '=', workspaceId)
        .execute();
    });
  }
  async call(
    lease: Lease,
    ordinal: number,
    model: AgentModel,
    request: ModelRequest,
    executionSignal?: AbortSignal,
    listener?: ConversationListener,
  ) {
    executionSignal?.throwIfAborted();
    const attempt = await this.dispatch(lease, ordinal, model, request).catch((error: unknown) => {
      // The dispatch transaction rolled back: no attempt or request exists.
      if (error instanceof AgentError && error.code === 'model_unavailable')
        throw new RefusedDispatch();
      throw error;
    });
    let result: ModelResult;
    try {
      const remaining = attempt.deadline_at.getTime() - Date.now();
      if (remaining <= 0) throw new AgentError('provider_error');
      const deadline = AbortSignal.timeout(remaining);
      const signal = executionSignal ? AbortSignal.any([deadline, executionSignal]) : deadline;
      result = await abortable(() => model.converse(request, signal, listener), signal);
    } catch (error) {
      await this.receipt(
        lease.workspaceId,
        attempt.id,
        null,
        error instanceof ModelError ? (error.usage ?? null) : null,
      );
      throw new AgentError('provider_error');
    }
    await this.receipt(lease.workspaceId, attempt.id, result);
    // A returned result never revives a cancelled/reclaimed run.
    await this.db.transaction().execute((trx) => lockRun(trx, lease));
    return result;
  }
  /**
   * Closes the run's calls still awaiting a receipt as `recovered_unknown`, on
   * the caller's transaction. A failed or interrupted turn runs this before it ends.
   */
  async reconcile(db: Database, run: Run) {
    await db
      .updateTable('agent_model_attempts')
      .set({
        outcome: 'recovered_unknown',
        settled_at: new Date(),
        error_code: 'worker_lost_after_dispatch',
        usage_complete: false,
      })
      .where('workspace_id', '=', run.workspace_id)
      .where('run_id', '=', run.id)
      .where('outcome', '=', 'dispatched')
      .execute();
  }
  recoverCancelled(workspaceIds: readonly string[], limit: number, graceSeconds: number) {
    if (!workspaceIds.length) return Promise.resolve(0);
    return this.db.transaction().execute(async (trx) => {
      const runs = await trx
        .selectFrom('agent_runs')
        .selectAll()
        .where('workspace_id', 'in', workspaceIds)
        .where('status', '=', 'cancelled')
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('agent_model_attempts')
              .select('id')
              .whereRef('agent_model_attempts.run_id', '=', 'agent_runs.id')
              .whereRef('agent_model_attempts.workspace_id', '=', 'agent_runs.workspace_id')
              .where('outcome', '=', 'dispatched')
              .where('deadline_at', '<=', new Date(Date.now() - graceSeconds * 1000)),
          ),
        )
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      // One transaction connection: runs are reconciled in order.
      for (const run of runs) await this.reconcile(trx, run); // NOSONAR
      return runs.length;
    });
  }
}
