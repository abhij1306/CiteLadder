import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import { jsonObjects, record, strings } from '../db/json.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import type {
  ProviderConnections,
  SearchIntelligenceRuns,
  SearchIntelligenceCalls,
  SearchIntelligenceDatasets,
} from '../generated/db-schema.ts';
import { runConnection } from './credentials.ts';
import { datasetKind, pageEstimateMicrousd, si, usdUnits } from './requests.ts';
import { INT4_MAX, normalizeResponse } from './normalization.ts';
import type { ResearchResponse } from './live.ts';
import type { ProviderError } from '../answer-engines/contracts.ts';
import { isDataError } from '../db/errors.ts';
import { rolesWith } from '../auth/workspace.ts';
import { loadWorkerSettings } from '../config.ts';
import { scalarText } from '../text-order.ts';
import {
  enqueueImplementationVerification,
  enqueueOpportunityRefresh,
} from '../opportunities/enqueue.ts';

/** Datasets whose rows say whether the project ranks for a search. */
const KEYWORD_EVIDENCE_KINDS = new Set(['missing_keywords', 'ranking_keywords', 'shared_keywords']);

type Run = Selectable<SearchIntelligenceRuns>;
type Call = Selectable<SearchIntelligenceCalls>;
type Dataset = Selectable<SearchIntelligenceDatasets>;
export type ResearchPlan = Record<string, unknown>;
export type PreparedResearch =
  | { action: 'stop' }
  | { action: 'skip' }
  | {
      action: 'dispatch' | 'publish';
      run: Run;
      call: Call;
      dataset: Dataset;
      ordinal: number;
      connection: Selectable<ProviderConnections>;
    };
const terminal = new Set(['succeeded', 'failed', 'partial', 'cancelled', 'uncertain']);
/** What one failed send means for the call and the run. */
function failureStates(error: ProviderError, ordinal: number) {
  const uncertain = ['connection', 'timeout'].includes(error.code),
    rateLimited = error.code === 'rate_limit',
    retry = rateLimited && ordinal <= si.rate_limit_retries;
  let attempt = 'failed';
  if (uncertain) attempt = 'uncertain';
  else if (rateLimited) attempt = 'rate_limited';
  let callStatus = 'failed';
  if (retry) callStatus = 'intent';
  else if (uncertain) callStatus = 'uncertain';
  // Every remaining call would use the same refused credential.
  return { uncertain, retry, refused: error.code === 'auth_failure', attempt, callStatus };
}
/** When a rate-limited call may be sent again: the provider's wait, bounded. */
const retryAt = (error: ProviderError, at: Date) =>
  new Date(
    at.getTime() +
      Math.min(
        si.rate_limit_max_wait_seconds,
        Math.max(0, error.retryAfterSeconds ?? si.rate_limit_default_wait_seconds),
      ) *
        1000,
  );
const money = usdUnits;
const amount = (value: number) => (value / 1e8).toFixed(8);

/** The run's cost, status and error after one paid page is added to it. */
function costUpdate(run: Run, call: Call, at: Date) {
  const totalCost = money(run.provider_reported_cost_usd) + money(call.provider_reported_cost_usd);
  const missingCost = call.provider_reported_cost_usd === null,
    over = totalCost > money(run.estimated_cost_usd);
  let status = 'running';
  let errorCode = run.error_code;
  if (missingCost) {
    status = 'uncertain';
    errorCode = 'provider_cost_unavailable';
  } else if (over) {
    status = 'partial';
    errorCode = 'cost_ceiling_exceeded';
  }
  const update = {
    provider_reported_cost_usd: missingCost ? run.provider_reported_cost_usd : amount(totalCost),
    uncertain_calls: run.uncertain_calls + (missingCost ? 1 : 0),
    status,
    error_code: errorCode,
    completed_at: missingCost || over ? at : null,
    updated_at: at,
  };
  return { update, missingCost, stopped: missingCost || over };
}
/** Whether a dataset holds everything asked for, some of it, nothing, or is unknowable. */
function datasetCoverage(o: {
  resultAvailable: boolean;
  received: number;
  kind: string;
  exhausted: boolean;
  saved: number;
  requested: number;
}) {
  if (!o.resultAvailable) return 'unknown';
  if (o.received === 0) return 'empty';
  const whole =
    ['footprint', 'backlink_summary', 'backlink_history'].includes(o.kind) ||
    o.exhausted ||
    o.saved >= o.requested;
  return whole ? 'complete' : 'partial';
}
/** Whether the provider holds more rows than were saved for a list dataset. */
function isTruncated(coverage: string, kind: string, total: number | null, saved: number) {
  if (coverage === 'partial') return true;
  return !['footprint', 'backlink_summary'].includes(kind) && total !== null && total > saved;
}

/** Root run lock precedes queue/call locks, matching cancellation's lock order. */
export class AcquisitionState {
  readonly db: Database;
  readonly task: QueueTask;
  readonly runId: string;
  readonly projectId: string;
  constructor(db: Database, task: QueueTask, runId: string) {
    // A Search Intelligence run always belongs to a project; fail here, not in a later query.
    if (!task.project_id) throw new Error('Search Intelligence task has no project');
    this.db = db;
    this.task = task;
    this.runId = runId;
    this.projectId = task.project_id;
  }
  run(db = this.db) {
    return db
      .selectFrom('search_intelligence_runs')
      .selectAll()
      .where('workspace_id', '=', this.task.workspace_id)
      .where('project_id', '=', this.projectId)
      .where('id', '=', this.runId);
  }
  calls(db = this.db) {
    return db
      .selectFrom('search_intelligence_calls')
      .selectAll()
      .where('workspace_id', '=', this.task.workspace_id)
      .where('project_id', '=', this.projectId)
      .where('run_id', '=', this.runId);
  }
  owned(db: Database) {
    return db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', this.task.workspace_id)
      .where('project_id', '=', this.task.project_id)
      .where('id', '=', this.task.id)
      .where('lease_owner', '=', this.task.lease_owner)
      .where('status', '=', 'running')
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .forUpdate()
      .executeTakeFirst();
  }
  terminalTask(db: Database) {
    return db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', this.task.workspace_id)
      .where('project_id', '=', this.task.project_id)
      .where('id', '=', this.task.id)
      .where('status', 'in', ['failed', 'cancelled'])
      .forUpdate()
      .executeTakeFirst();
  }
  async connection(db: Database, run: Run) {
    const member = await db
      .selectFrom('workspace_members')
      .select('id')
      .where('workspace_id', '=', run.workspace_id)
      .where('user_id', '=', run.actor_user_id)
      .where('role', 'in', rolesWith('run'))
      .executeTakeFirst();
    if (!member) return undefined;
    return runConnection(db, run);
  }
  start(at = new Date()) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (!run || terminal.has(run.status) || !(await this.owned(trx))) return null;
      if (
        !run.confirmed_at ||
        run.pricing_version !== si.price_version ||
        !(await this.connection(trx, run))
      ) {
        await trx
          .updateTable('search_intelligence_runs')
          .set({
            status: 'failed',
            error_code:
              run.pricing_version !== si.price_version ? 'pricing_changed' : 'connection_changed',
            completed_at: at,
            updated_at: at,
          })
          .where('id', '=', run.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
        await this.closeCollecting(trx, at);
        return null;
      }
      await trx
        .updateTable('search_intelligence_runs')
        .set({ status: 'running', updated_at: at })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      return jsonObjects(run.call_plan, 'Search Intelligence plan');
    });
  }
  prepare(plan: ResearchPlan, sequence: number, at = new Date()): Promise<PreparedResearch> {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (run?.status !== 'running' || !(await this.owned(trx))) return { action: 'stop' };
      const connection = await this.connection(trx, run);
      if (!connection) {
        await this.failChangedConnection(trx, run, at);
        return { action: 'stop' };
      }
      const request = record(plan.request);
      const kind = datasetKind(plan.dataset_kind);
      const dataset = await this.upsertDataset(trx, run, plan, kind, at);
      if (['published', 'failed'].includes(dataset.status)) return { action: 'skip' };
      const requestKey = `${plan.dataset_key}:${plan.page}`;
      let call = await this.calls(trx)
        .where('request_key', '=', requestKey)
        .forUpdate()
        .executeTakeFirst();
      if (!call)
        call = await trx
          .insertInto('search_intelligence_calls')
          .values({
            id: randomUUID(),
            workspace_id: run.workspace_id,
            project_id: run.project_id,
            run_id: run.id,
            dataset_id: dataset.id,
            request_key: requestKey,
            sequence,
            endpoint: String(plan.endpoint),
            sanitized_request: JSON.stringify(request),
            estimated_cost_usd: String(plan.estimated_cost_usd),
            status: 'intent',
            created_at: at,
            completed_at: null,
            dispatched_at: null,
            error_code: '',
            error_detail: '',
            provider_reported_cost_usd: null,
            provider_task_id: '',
            response_sha256: '',
            sanitized_response: null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      if (['succeeded', 'failed', 'uncertain'].includes(call.status)) return { action: 'skip' };
      const latest = await trx
        .selectFrom('search_intelligence_dispatch_attempts')
        .selectAll()
        .where('workspace_id', '=', run.workspace_id)
        .where('project_id', '=', run.project_id)
        .where('call_id', '=', call.id)
        .where('phase', '=', 'dispatch')
        .orderBy('ordinal', 'desc')
        .executeTakeFirst();
      // The reviewed estimate is a ceiling: never send a call that could pass it.
      // The page's own price, not the stored average: a short last page costs less.
      const pageCost = pageEstimateMicrousd(kind, Number(request.limit)) * 100;
      if (
        call.status === 'intent' &&
        money(run.provider_reported_cost_usd) + pageCost > money(run.estimated_cost_usd)
      ) {
        await this.stopRun(trx, run, 'cost_ceiling_reached', at);
        return { action: 'stop' };
      }
      if (call.status === 'dispatched' && call.sanitized_response === null) {
        if (latest)
          await this.outcome(
            trx,
            call,
            latest.ordinal,
            latest.dispatched_at,
            'uncertain',
            null,
            at,
          );
        await trx
          .updateTable('search_intelligence_calls')
          .set({ status: 'uncertain', completed_at: at, error_code: 'provider_result_missing' })
          .where('id', '=', call.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
        await trx
          .updateTable('search_intelligence_runs')
          .set({
            status: 'uncertain',
            uncertain_calls: run.uncertain_calls + 1,
            completed_at: at,
            updated_at: at,
          })
          .where('id', '=', run.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
        await this.closeCollecting(trx, at);
        return { action: 'stop' };
      }
      return {
        action: call.status === 'dispatched' ? 'publish' : 'dispatch',
        run,
        call,
        dataset,
        ordinal: (latest?.ordinal ?? 0) + 1,
        connection,
      };
    });
  }
  async outcome(
    db: Database,
    call: Call,
    ordinal: number,
    dispatched: Date,
    status: string,
    error: ProviderError | null,
    at: Date,
  ) {
    const prior = await db
      .selectFrom('search_intelligence_dispatch_attempts')
      .select('id')
      .where('workspace_id', '=', call.workspace_id)
      .where('project_id', '=', call.project_id)
      .where('call_id', '=', call.id)
      .where('ordinal', '=', ordinal)
      .where('phase', '=', 'outcome')
      .executeTakeFirst();
    if (!prior)
      await db
        .insertInto('search_intelligence_dispatch_attempts')
        .values({
          id: randomUUID(),
          workspace_id: call.workspace_id,
          project_id: call.project_id,
          call_id: call.id,
          ordinal,
          phase: 'outcome',
          status,
          error_code: error?.code ?? '',
          retry_after_seconds: error?.retryAfterSeconds ?? null,
          dispatched_at: dispatched,
          completed_at: at,
        })
        .execute();
  }
  dispatch(
    prepared: Extract<PreparedResearch, { action: 'dispatch' | 'publish' }>,
    at = new Date(),
  ) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (
        run?.status !== 'running' ||
        !(await this.owned(trx)) ||
        !(await this.connection(trx, run))
      )
        return false;
      const call = await this.calls(trx)
        .where('id', '=', prepared.call.id)
        .where('status', '=', 'intent')
        .forUpdate()
        .executeTakeFirst();
      if (!call) return false;
      await trx
        .updateTable('search_intelligence_calls')
        .set({ status: 'dispatched', dispatched_at: at })
        .where('id', '=', call.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      await trx
        .insertInto('search_intelligence_dispatch_attempts')
        .values({
          id: randomUUID(),
          workspace_id: run.workspace_id,
          project_id: run.project_id,
          call_id: call.id,
          ordinal: prepared.ordinal,
          phase: 'dispatch',
          status: 'dispatched',
          error_code: '',
          retry_after_seconds: null,
          dispatched_at: at,
          completed_at: null,
        })
        .execute();
      return true;
    });
  }
  /** Raw paid response survives a lost queue lease; projection recovery uses this exact receipt. */
  saveResponse(callId: string, response: ResearchResponse, at = new Date()) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (!run) return;
      const call = await this.calls(trx)
        .where('id', '=', callId)
        .where('status', 'in', ['dispatched', 'uncertain'])
        .forUpdate()
        .executeTakeFirst();
      if (call?.sanitized_response !== null) return;
      await trx
        .updateTable('search_intelligence_calls')
        .set({
          sanitized_response: JSON.stringify(response.body),
          response_sha256: response.hash,
          provider_task_id: response.taskId,
          provider_reported_cost_usd: response.cost,
        })
        .where('id', '=', call.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      const latest = await trx
        .selectFrom('search_intelligence_dispatch_attempts')
        .selectAll()
        .where('workspace_id', '=', run.workspace_id)
        .where('project_id', '=', run.project_id)
        .where('call_id', '=', call.id)
        .where('phase', '=', 'dispatch')
        .orderBy('ordinal', 'desc')
        .executeTakeFirst();
      if (latest)
        await this.outcome(trx, call, latest.ordinal, latest.dispatched_at, 'succeeded', null, at);
      if (['cancelled', 'uncertain', 'failed', 'partial'].includes(run.status)) {
        const costs = await this.calls(trx).select('provider_reported_cost_usd').execute();
        await trx
          .updateTable('search_intelligence_runs')
          .set({
            provider_reported_cost_usd: amount(
              costs.reduce((sum, item) => sum + money(item.provider_reported_cost_usd), 0),
            ),
            updated_at: at,
          })
          .where('id', '=', run.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
      }
    });
  }
  park(at: Date) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (run?.status !== 'running' || !(await this.owned(trx))) return;
      await trx
        .updateTable('search_intelligence_runs')
        .set({ status: 'queued', updated_at: new Date() })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      await trx
        .updateTable('analytics_tasks')
        .set({
          status: 'retry_wait',
          available_at: at,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: new Date(),
        })
        .where('id', '=', this.task.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
    });
  }
  publish(
    plan: ResearchPlan,
    callId: string,
    later: ResearchPlan[],
    at = new Date(),
    terminalTask = false,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (
        !run ||
        !['running', 'queued'].includes(run.status) ||
        !(terminalTask ? await this.terminalTask(trx) : await this.owned(trx))
      )
        return true;
      const call = await this.calls(trx)
        .where('id', '=', callId)
        .where('status', '=', 'dispatched')
        .forUpdate()
        .executeTakeFirst();
      if (!call?.sanitized_response) return true;
      const dataset = await trx
        .selectFrom('search_intelligence_datasets')
        .selectAll()
        .where('workspace_id', '=', run.workspace_id)
        .where('project_id', '=', run.project_id)
        .where('id', '=', call.dataset_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const { update, missingCost, stopped } = costUpdate(run, call, at);
      await trx
        .updateTable('search_intelligence_calls')
        .set({ status: 'succeeded', completed_at: at })
        .where('id', '=', call.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      let normalized: ReturnType<typeof normalizeResponse>;
      try {
        normalized = normalizeResponse(dataset.dataset_kind, record(call.sanitized_response), plan);
      } catch {
        await this.failScopeViolation(trx, { run, call, dataset, update, missingCost }, at);
        return true;
      }
      // Bound SQL parameters even when a provider returns more than the requested page.
      for (let offset = 0; offset < normalized.rows.length; offset += si.page_size)
        await trx
          .insertInto('search_intelligence_rows')
          .values(
            normalized.rows.slice(offset, offset + si.page_size).map((row) => ({
              ...row,
              auxiliary: JSON.stringify(row.auxiliary),
              id: randomUUID(),
              workspace_id: run.workspace_id,
              project_id: run.project_id,
              dataset_id: dataset.id,
              call_id: call.id,
              row_kind: dataset.dataset_kind,
              created_at: at,
            })),
          )
          .onConflict((oc) => oc.columns(['dataset_id', 'provider_row_key']).doNothing())
          .execute();
      const count = await trx
        .selectFrom('search_intelligence_rows')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('workspace_id', '=', run.workspace_id)
        .where('project_id', '=', run.project_id)
        .where('dataset_id', '=', dataset.id)
        .executeTakeFirstOrThrow();
      const received = dataset.raw_rows_received + normalized.received,
        exhausted = normalized.received < Number(record(plan.request).limit ?? 1),
        finished = !later.some((item) => item.dataset_key === plan.dataset_key) || exhausted;
      const coverage = datasetCoverage({
        resultAvailable: Boolean(normalized.summary.result_available),
        received,
        kind: dataset.dataset_kind,
        exhausted,
        saved: count.count,
        requested: dataset.requested_rows,
      });
      const total = normalized.total ?? dataset.provider_total;
      await trx
        .updateTable('search_intelligence_datasets')
        .set({
          raw_rows_received: received,
          unique_rows_saved: count.count,
          provider_total: total !== null && total > INT4_MAX ? null : total,
          summary: JSON.stringify({
            ...record(dataset.summary),
            ...normalized.summary,
            source_call_ids: [...strings(record(dataset.summary).source_call_ids), call.id],
          }),
          ...(finished
            ? {
                status: 'published',
                coverage,
                truncated: isTruncated(coverage, dataset.dataset_kind, total, count.count),
                collection_ended_at: at,
                published_at: at,
              }
            : {}),
        })
        .where('id', '=', dataset.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      if (finished && KEYWORD_EVIDENCE_KINDS.has(dataset.dataset_kind))
        await this.announce(trx, dataset.id);
      await trx
        .updateTable('search_intelligence_runs')
        .set({
          ...update,
          completed_calls: run.completed_calls + 1,
          received_rows: run.received_rows + normalized.rows.length,
        })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      if (stopped) await this.closeCollecting(trx, at);
      return stopped;
    });
  }
  fail(
    prepared: Extract<PreparedResearch, { action: 'dispatch' | 'publish' }>,
    error: ProviderError,
    at = new Date(),
  ) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (run?.status !== 'running' || !(await this.owned(trx))) return { stop: true, wait: null };
      const call = await this.calls(trx)
        .where('id', '=', prepared.call.id)
        .where('status', '=', 'dispatched')
        .forUpdate()
        .executeTakeFirst();
      if (!call) return { stop: true, wait: null };
      const { uncertain, retry, refused, attempt, callStatus } = failureStates(
        error,
        prepared.ordinal,
      );
      await this.outcome(trx, call, prepared.ordinal, call.dispatched_at!, attempt, error, at);
      await trx
        .updateTable('search_intelligence_calls')
        .set({
          status: callStatus,
          dispatched_at: retry ? null : call.dispatched_at,
          completed_at: retry ? null : at,
          error_code: error.code,
          error_detail: error.message,
        })
        .where('id', '=', call.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      if (!retry)
        await trx
          .updateTable('search_intelligence_datasets')
          .set({ status: 'failed', coverage: 'unknown', collection_ended_at: at })
          .where('id', '=', call.dataset_id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
      if (uncertain)
        await trx
          .updateTable('search_intelligence_runs')
          .set({
            status: 'uncertain',
            uncertain_calls: run.uncertain_calls + 1,
            completed_at: at,
            updated_at: at,
          })
          .where('id', '=', run.id)
          .where('workspace_id', '=', run.workspace_id)
          .execute();
      if (uncertain) await this.closeCollecting(trx, at);
      else if (refused) await this.stopRun(trx, run, error.code, at);
      return { stop: uncertain || refused, wait: retry ? retryAt(error, at) : null };
    });
  }
  finish(at = new Date()) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (run?.status !== 'running' || !(await this.owned(trx))) return;
      await this.closeCollecting(trx, at);
      const datasets = await trx
        .selectFrom('search_intelligence_datasets')
        .select(['status', 'coverage'])
        .where('workspace_id', '=', run.workspace_id)
        .where('project_id', '=', run.project_id)
        .where('run_id', '=', run.id)
        .execute();
      const failed = datasets.some(
        (item) => item.status === 'failed' || item.coverage === 'unknown',
      );
      await trx
        .updateTable('search_intelligence_runs')
        .set({ status: failed ? 'partial' : 'succeeded', completed_at: at, updated_at: at })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
    });
  }
  /** The run's collecting datasets close and the run ends once its connection has changed. */
  private async failChangedConnection(trx: Database, run: Run, at: Date) {
    await trx
      .updateTable('search_intelligence_runs')
      .set({
        status: run.completed_calls ? 'partial' : 'failed',
        error_code: 'connection_changed',
        completed_at: at,
        updated_at: at,
      })
      .where('id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await this.closeCollecting(trx, at);
  }
  /** The plan's dataset for this run: the existing locked row, or a new collecting one. */
  private async upsertDataset(
    trx: Database,
    run: Run,
    plan: ResearchPlan,
    kind: ReturnType<typeof datasetKind>,
    at: Date,
  ) {
    const target = record(plan.target),
      comparison = record(plan.comparison),
      request = record(plan.request);
    let dataset = await trx
      .selectFrom('search_intelligence_datasets')
      .selectAll()
      .where('workspace_id', '=', run.workspace_id)
      .where('project_id', '=', run.project_id)
      .where('run_id', '=', run.id)
      .where('scope_hash', '=', String(plan.scope_hash))
      .forUpdate()
      .executeTakeFirst();
    if (!dataset)
      dataset = await trx
        .insertInto('search_intelligence_datasets')
        .values({
          id: randomUUID(),
          workspace_id: run.workspace_id,
          project_id: run.project_id,
          run_id: run.id,
          dataset_kind: kind,
          scope_hash: String(plan.scope_hash),
          target_domain: String(target.registrable_domain),
          target_hostname: String(target.hostname),
          target_origin: String(target.origin),
          comparison_origin: scalarText(comparison.origin ?? ''),
          location_code: si.backlink_kinds.includes(kind) ? null : Number(request.location_code),
          language_code: si.backlink_kinds.includes(kind)
            ? ''
            : scalarText(request.language_code ?? ''),
          requested_rows: Number(plan.requested_rows),
          provider_filters: JSON.stringify({
            ...request,
            research_scope: plan.research_scope ?? 'exact_host',
          }),
          collection_started_at: at,
          collection_ended_at: null,
          published_at: null,
          parent_dataset_id: null,
          parser_version: si.parser_version,
          status: 'collecting',
          coverage: 'unknown',
          created_at: at,
          provider_total: null,
          raw_rows_received: 0,
          unique_rows_saved: 0,
          truncated: false,
          summary: JSON.stringify({}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    return dataset;
  }
  /** A paid page escaped the reviewed scope: its call and dataset fail and the run stops. */
  private async failScopeViolation(
    trx: Database,
    o: {
      run: Run;
      call: Call;
      dataset: Dataset;
      update: ReturnType<typeof costUpdate>['update'];
      missingCost: boolean;
    },
    at: Date,
  ) {
    const { run, call, dataset, update, missingCost } = o;
    await trx
      .updateTable('search_intelligence_calls')
      .set({
        status: 'failed',
        error_code: 'provider_scope_violation',
        error_detail: 'Provider results escaped the reviewed scope',
      })
      .where('id', '=', call.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await trx
      .updateTable('search_intelligence_datasets')
      .set({ status: 'failed', coverage: 'unknown', collection_ended_at: at })
      .where('id', '=', dataset.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await trx
      .updateTable('search_intelligence_runs')
      .set({
        ...update,
        status: missingCost ? 'uncertain' : 'partial',
        error_code: 'provider_scope_violation',
        completed_at: at,
      })
      .where('id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await this.closeCollecting(trx, at);
  }
  /** A published keyword dataset can open or close keyword-gap Actions. */
  private async announce(trx: Database, datasetId: string) {
    const trigger = {
      workspaceId: this.task.workspace_id,
      projectId: this.projectId,
      triggerKind: 'search_intelligence_dataset',
      triggerId: datasetId,
      maxAttempts: loadWorkerSettings().taskMaxAttempts,
    };
    await enqueueOpportunityRefresh(trx, trigger);
    await enqueueImplementationVerification(trx, trigger);
  }
  /** Publish a saved receipt; one the schema refuses fails its dataset instead of blocking the run. */
  async settle(
    plan: ResearchPlan,
    callId: string,
    later: ResearchPlan[],
    at = new Date(),
    terminalTask = false,
  ) {
    try {
      return await this.publish(plan, callId, later, at, terminalTask);
    } catch (cause) {
      if (!isDataError(cause)) throw cause;
      return this.reject(callId, at, terminalTask);
    }
  }
  /** The paid receipt stays as provenance; its reported cost still counts. */
  reject(callId: string, at = new Date(), terminalTask = false) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (
        !run ||
        !['running', 'queued'].includes(run.status) ||
        !(terminalTask ? await this.terminalTask(trx) : await this.owned(trx))
      )
        return true;
      const call = await this.calls(trx)
        .where('id', '=', callId)
        .where('status', '=', 'dispatched')
        .forUpdate()
        .executeTakeFirst();
      if (!call) return true;
      await trx
        .updateTable('search_intelligence_calls')
        .set({
          status: 'failed',
          completed_at: at,
          error_code: 'normalization_failed',
          error_detail: 'The provider response could not be saved',
        })
        .where('id', '=', call.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      await trx
        .updateTable('search_intelligence_datasets')
        .set({ status: 'failed', coverage: 'unknown', collection_ended_at: at })
        .where('id', '=', call.dataset_id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      const missingCost = call.provider_reported_cost_usd === null;
      await trx
        .updateTable('search_intelligence_runs')
        .set({
          provider_reported_cost_usd: missingCost
            ? run.provider_reported_cost_usd
            : amount(
                money(run.provider_reported_cost_usd) + money(call.provider_reported_cost_usd),
              ),
          ...(missingCost
            ? {
                status: 'uncertain',
                uncertain_calls: run.uncertain_calls + 1,
                error_code: 'provider_cost_unavailable',
                completed_at: at,
              }
            : {}),
          updated_at: at,
        })
        .where('id', '=', run.id)
        .where('workspace_id', '=', run.workspace_id)
        .execute();
      if (missingCost) await this.closeCollecting(trx, at);
      return missingCost;
    });
  }
  /** A local check failed before dispatch: nothing was sent, and no later call can be either. */
  refuse(
    prepared: Extract<PreparedResearch, { action: 'dispatch' | 'publish' }>,
    error: ProviderError,
    at = new Date(),
  ) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (run?.status !== 'running' || !(await this.owned(trx))) return;
      await trx
        .updateTable('search_intelligence_calls')
        .set({ status: 'failed', completed_at: at, error_code: error.code, error_detail: '' })
        .where('id', '=', prepared.call.id)
        .where('workspace_id', '=', run.workspace_id)
        .where('status', '=', 'intent')
        .execute();
      await this.stopRun(trx, run, error.code, at);
    });
  }
  /** End a running run early; completed datasets remain. */
  private async stopRun(trx: Database, run: Run, code: string, at: Date) {
    await trx
      .updateTable('search_intelligence_runs')
      .set({
        status: run.completed_calls ? 'partial' : 'failed',
        error_code: code,
        completed_at: at,
        updated_at: at,
      })
      .where('id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await this.closeCollecting(trx, at);
  }
  /** A terminal run cannot leave a dataset waiting for another paid dispatch. */
  closeCollecting(db: Database, at: Date) {
    return db
      .updateTable('search_intelligence_datasets')
      .set({ status: 'failed', coverage: 'unknown', collection_ended_at: at })
      .where('workspace_id', '=', this.task.workspace_id)
      .where('project_id', '=', this.task.project_id)
      .where('run_id', '=', this.runId)
      .where('status', '=', 'collecting')
      .execute();
  }
}
