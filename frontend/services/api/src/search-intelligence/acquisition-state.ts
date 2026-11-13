import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import { jsonObjects, record } from '../db/json.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import type {
  ProviderConnections,
  SearchIntelligenceRuns,
  SearchIntelligenceCalls,
  SearchIntelligenceDatasets,
} from '../generated/db-schema.ts';
import { runConnection } from './credentials.ts';
import { datasetKind, pageEstimateMicrousd, si } from './requests.ts';
import { normalizeResponse } from './normalization.ts';
import type { ResearchResponse } from './live.ts';
import type { ProviderError } from '../providers/errors.ts';
import { isDataError } from '../db/errors.ts';
import { memberCan } from '../auth/workspace.ts';
import { announceEvidence } from '../opportunities/evidence-announcement.ts';
import {
  costUpdate,
  failureStates,
  money,
  rejectedCost,
  retryAt,
  stoppedRun,
  summedCost,
  uncertainRun,
} from './acquisition-costs.ts';
import { newAttempt, newCall, newDataset, newRows, publishedPage } from './acquisition-rows.ts';
import {
  callDataset,
  callsQuery,
  endedTask,
  latestDispatch,
  ownedTask,
  priorOutcome,
  runDatasets,
  runQuery,
  scopedDataset,
} from './acquisition-reads.ts';

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
    return runQuery(db, this);
  }
  calls(db = this.db) {
    return callsQuery(db, this);
  }
  owned(db: Database) {
    return ownedTask(db, this);
  }
  terminalTask(db: Database) {
    return endedTask(db, this);
  }
  async connection(db: Database, run: Run) {
    if (!(await memberCan(db, run.workspace_id, run.actor_user_id, 'run'))) return undefined;
    return runConnection(db, run);
  }
  start(at = new Date()) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (!run || terminal.has(run.status) || !(await this.owned(trx))) return null;
      // A parked run may already have published datasets, so a restart that
      // finds the price or connection changed ends it like any other stop.
      const priced = run.pricing_version === si.price_version;
      if (!priced || !run.confirmed_at || !(await this.connection(trx, run))) {
        await this.stopRun(trx, run, priced ? 'connection_changed' : 'pricing_changed', at);
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
        await this.stopRun(trx, run, 'connection_changed', at);
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
          .values(newCall({ run, datasetId: dataset.id, requestKey, sequence, plan, request, at }))
          .returningAll()
          .executeTakeFirstOrThrow();
      if (['succeeded', 'failed', 'uncertain'].includes(call.status)) return { action: 'skip' };
      const latest = await latestDispatch(trx, run, call.id);
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
          .set(uncertainRun(run, at))
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
    const prior = await priorOutcome(db, call, ordinal);
    if (!prior)
      await db
        .insertInto('search_intelligence_dispatch_attempts')
        .values(newAttempt(call, { ordinal, phase: 'outcome', status, error, dispatched, at }))
        .execute();
  }
  dispatch(
    prepared: Extract<PreparedResearch, { action: 'dispatch' | 'publish' }>,
    at = new Date(),
  ) {
    return this.db.transaction().execute(async (trx) => {
      const run = await this.run(trx).forUpdate().executeTakeFirst();
      if (run?.status !== 'running' || !(await this.owned(trx))) return false;
      // A connection or member change since `prepare` ends the run, as there:
      // returning without a transition would leave it running with its hold.
      if (!(await this.connection(trx, run))) {
        await this.stopRun(trx, run, 'connection_changed', at);
        return false;
      }
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
        .values(
          newAttempt(call, {
            ordinal: prepared.ordinal,
            phase: 'dispatch',
            status: 'dispatched',
            error: null,
            dispatched: at,
            at: null,
          }),
        )
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
      const latest = await latestDispatch(trx, run, call.id);
      if (latest)
        await this.outcome(trx, call, latest.ordinal, latest.dispatched_at, 'succeeded', null, at);
      if (['cancelled', 'uncertain', 'failed', 'partial'].includes(run.status)) {
        const costs = await this.calls(trx).select('provider_reported_cost_usd').execute();
        await trx
          .updateTable('search_intelligence_runs')
          .set({ provider_reported_cost_usd: summedCost(costs), updated_at: at })
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
      const dataset = await callDataset(trx, run, call.dataset_id);
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
      // The locked dataset's saved count grows by the rows this page added; never a recount.
      let saved = dataset.unique_rows_saved;
      for (let offset = 0; offset < normalized.rows.length; offset += si.page_size) {
        const [inserted] = await trx // NOSONAR -- One transaction: pages insert in order.
          .insertInto('search_intelligence_rows')
          .values(
            newRows(normalized.rows.slice(offset, offset + si.page_size), dataset, call.id, at),
          )
          .onConflict((oc) => oc.columns(['dataset_id', 'provider_row_key']).doNothing())
          .execute();
        saved += Number(inserted?.numInsertedOrUpdatedRows ?? 0n);
      }
      const page = publishedPage({ dataset, normalized, plan, later, saved, callId: call.id, at });
      const { finished } = page;
      await trx
        .updateTable('search_intelligence_datasets')
        .set(page.update)
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
          .set(uncertainRun(run, at))
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
      const datasets = await runDatasets(trx, run);
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
  /** The plan's dataset for this run: the existing locked row, or a new collecting one. */
  private async upsertDataset(
    trx: Database,
    run: Run,
    plan: ResearchPlan,
    kind: ReturnType<typeof datasetKind>,
    at: Date,
  ) {
    let dataset = await scopedDataset(trx, run, String(plan.scope_hash));
    if (!dataset)
      dataset = await trx
        .insertInto('search_intelligence_datasets')
        .values(newDataset(run, plan, kind, at))
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
    await announceEvidence(
      trx,
      { workspaceId: this.task.workspace_id, projectId: this.projectId },
      { kind: 'search_intelligence_dataset', id: datasetId },
    );
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
      const { missingCost, update } = rejectedCost(run, call, at);
      await trx
        .updateTable('search_intelligence_runs')
        .set(update)
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
      .set(stoppedRun(run, code, at))
      .where('id', '=', run.id)
      .where('workspace_id', '=', run.workspace_id)
      .execute();
    await this.closeCollecting(trx, at);
  }
  closeCollecting(db: Database, at: Date) {
    const { workspace_id: workspaceId, project_id: projectId } = this.task;
    return closeCollecting(db, { workspaceId, projectId, runId: this.runId }, at);
  }
}

/** A terminal run cannot leave a dataset waiting for another paid dispatch. */
export function closeCollecting(
  db: Database,
  run: { workspaceId: string; projectId: string | null; runId: string },
  at: Date,
) {
  return db
    .updateTable('search_intelligence_datasets')
    .set({ status: 'failed', coverage: 'unknown', collection_ended_at: at })
    .where('workspace_id', '=', run.workspaceId)
    .where('project_id', '=', run.projectId)
    .where('run_id', '=', run.runId)
    .where('status', '=', 'collecting')
    .execute();
}
