import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type {
  ConversationListener,
  ConversationRequest,
  ConversationResult,
} from '../models/conversation.ts';
import { authorize } from './access.ts';
import { abortable } from './async.ts';
import { AgentError, budgetSchema, type Lease, type ModelAttempt, type Run } from './contracts.ts';
import { lockRun } from './queue.ts';

export type ModelResult = ConversationResult;
export type ModelRequest = ConversationRequest;
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
type Hold = { reservationId: string | null; credits: number; pricingRevision: string };
/**
 * The dispatch seam: `reserve` rechecks the frozen model and configuration
 * before a call, `settle` records its receipt. Self-hosted calls hold and
 * charge nothing; both run on the caller's transaction.
 */
export type Funding = {
  reserve: (
    db: Database,
    run: Run,
    dispatchId: string,
    model: AgentModel,
    request: ModelRequest,
  ) => Promise<Hold>;
  settle: (
    db: Database,
    attempt: ModelAttempt,
    result: ModelResult | null,
  ) => Promise<{ credits: number; status: string }>;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class ModelCalls {
  readonly db: Database;
  readonly funding: Funding;
  constructor(db: Database, funding: Funding) {
    this.db = db;
    this.funding = funding;
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
      const dispatchId = randomUUID();
      const hold = await this.funding.reserve(trx, run, dispatchId, model, request);
      // Self-hosted calls reserve nothing; a hold is only the dispatch recheck.
      if (hold.reservationId !== null || hold.credits !== 0)
        throw new AgentError('funding_unavailable');
      const now = new Date();
      const attempt = await trx
        .insertInto('agent_model_attempts')
        .values({
          id: randomUUID(),
          workspace_id: run.workspace_id,
          project_id: run.project_id,
          run_id: run.id,
          dispatch_id: dispatchId,
          run_attempt: run.attempt_count,
          ordinal,
          funding_source: run.funding_source,
          provider_adapter: model.adapter,
          endpoint_host: model.endpointHost,
          requested_model: run.requested_model,
          returned_model: '',
          pricing_revision: hold.pricingRevision,
          reservation_id: hold.reservationId,
          reserved_credits: hold.credits,
          debited_credits: 0,
          input_tokens: null,
          cached_input_tokens: null,
          cache_write_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
          total_tokens: null,
          usage_complete: false,
          settlement_status: 'not_applicable',
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
  /** Receipt settlement outlives cancellation/lease loss; first settlement wins. */
  receipt(workspaceId: string, attemptId: string, result: ModelResult | null) {
    const outcome = result ? 'completed' : 'failed';
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
        const value = result?.usage[name];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? value
          : null;
      };
      const now = new Date();
      const updated = {
        ...attempt,
        input_tokens: usage('input_tokens'),
        output_tokens: usage('output_tokens'),
        cached_input_tokens: usage('cached_input_tokens'),
        cache_write_input_tokens: usage('cache_write_input_tokens'),
        reasoning_tokens: usage('reasoning_tokens'),
        total_tokens: usage('total_tokens'),
        usage_complete: usage('input_tokens') !== null && usage('output_tokens') !== null,
        outcome,
        settled_at: now,
      };
      const stored = (value: number | null) => (value === null ? null : String(value));
      const settled = await this.funding.settle(
        trx,
        {
          ...updated,
          input_tokens: stored(updated.input_tokens),
          output_tokens: stored(updated.output_tokens),
          cached_input_tokens: stored(updated.cached_input_tokens),
          cache_write_input_tokens: stored(updated.cache_write_input_tokens),
          reasoning_tokens: stored(updated.reasoning_tokens),
          total_tokens: stored(updated.total_tokens),
        },
        result,
      );
      if (settled.credits !== 0) throw new AgentError('funding_unavailable');
      await trx
        .updateTable('agent_model_attempts')
        .set({
          input_tokens: updated.input_tokens,
          output_tokens: updated.output_tokens,
          cached_input_tokens: updated.cached_input_tokens,
          cache_write_input_tokens: updated.cache_write_input_tokens,
          reasoning_tokens: updated.reasoning_tokens,
          total_tokens: updated.total_tokens,
          usage_complete: updated.usage_complete,
          outcome,
          settled_at: now,
          late_receipt: now > attempt.deadline_at,
          returned_model: result?.returned_model.slice(0, 255) ?? '',
          finish_status: result?.finish_status.slice(0, 64) ?? '',
          output_hash: result ? hash(JSON.stringify(result.blocks)) : '',
          error_code: result ? '' : 'provider_error',
          latency_ms: result?.latency_ms ?? null,
          settlement_status: settled.status,
          debited_credits: settled.credits,
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
    const attempt = await this.dispatch(lease, ordinal, model, request);
    let result: ModelResult;
    try {
      const remaining = attempt.deadline_at.getTime() - Date.now();
      if (remaining <= 0) throw new AgentError('provider_error');
      const deadline = AbortSignal.timeout(remaining);
      const signal = executionSignal ? AbortSignal.any([deadline, executionSignal]) : deadline;
      result = await abortable(() => model.converse(request, signal, listener), signal);
    } catch {
      await this.receipt(lease.workspaceId, attempt.id, null);
      throw new AgentError('provider_error');
    }
    await this.receipt(lease.workspaceId, attempt.id, result);
    // A returned result never revives a cancelled/reclaimed run.
    await this.db.transaction().execute((trx) => lockRun(trx, lease));
    return result;
  }
  async reconcile(db: Database, run: Run) {
    const attempts = await db
      .selectFrom('agent_model_attempts')
      .selectAll()
      .where('workspace_id', '=', run.workspace_id)
      .where('run_id', '=', run.id)
      .where('outcome', '=', 'dispatched')
      .forUpdate()
      .execute();
    for (const attempt of attempts) {
      const updated = {
        ...attempt,
        outcome: 'recovered_unknown',
        usage_complete: false,
        settled_at: new Date(),
      };
      // Settlement and its attempt write share one ordered transaction.
      const settled = await this.funding.settle(db, updated, null); // NOSONAR
      if (settled.credits !== 0) throw new AgentError('funding_unavailable');
      await db // NOSONAR
        .updateTable('agent_model_attempts')
        .set({
          outcome: updated.outcome,
          settled_at: updated.settled_at,
          error_code: 'worker_lost_after_dispatch',
          settlement_status: settled.status,
          debited_credits: settled.credits,
          usage_complete: false,
        })
        .where('workspace_id', '=', run.workspace_id)
        .where('id', '=', attempt.id)
        .execute();
    }
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
      // One transaction connection: settlements run in order.
      for (const run of runs) await this.reconcile(trx, run); // NOSONAR
      return runs.length;
    });
  }
}
