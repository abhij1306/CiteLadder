import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { ProviderError } from '../providers/errors.ts';
import { type OverviewResult, overviewAnswer } from '../search-surfaces/parsing.ts';
import { searchPolicy } from '../search-surfaces/dataforseo.ts';
import { ownedAuditTask, parkAuditTask, type AuditTask } from '../queue/audit-queue.ts';
import {
  persistSurfaceFailure,
  persistExecutionSuccess,
  appendProviderAttempt,
  type DeriveExecution,
} from './result-persistence.ts';
import { type AuditRuntime } from './config.ts';

async function appendObservation(db: Database, task: AuditTask, result: OverviewResult, at: Date) {
  const request = record(task.request_snapshot);
  const observation = await db
    .insertInto('aio_observations')
    .values({
      id: randomUUID(),
      workspace_id: task.workspace_id,
      audit_id: task.audit_id,
      task_id: task.id,
      outcome: result.outcome,
      error_code: result.error_code,
      provider_status_code: result.provider_status_code,
      aio_present: result.aio_present,
      aio_serp_position: result.aio_serp_position,
      location_code: Number(request.location_code),
      language_code: String(request.language_code),
      device: String(request.device),
      provider_task_id: task.provider_task_id,
      provider_submission_ref: task.provider_submission_ref,
      provider_connection_id: task.provider_connection_id,
      element_count: result.elements.length,
      reference_count: result.references.length,
      observed_at: result.observed_at,
      retrieved_at: at,
      created_at: at,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (result.links.length)
    await db
      .insertInto('aio_entity_links')
      .values(
        result.links.map((link) => ({
          ...link,
          id: randomUUID(),
          workspace_id: task.workspace_id,
          observation_id: observation.id,
          created_at: at,
        })),
      )
      .execute();
}
/** Whether a Google AI Overview result is an observation (present or absent) rather than a failure. */
export const isOverviewObservation = (result: OverviewResult) =>
  searchPolicy.surface.successful_outcomes.includes(result.outcome);

/** Observation, raw evidence, derived analysis and queue terminal state share the owned transaction. */
export function persistOverviewObservation(
  db: Database,
  task: AuditTask,
  owner: string,
  result: OverviewResult,
  derive: DeriveExecution,
  at = new Date(),
) {
  if (!isOverviewObservation(result)) throw new Error('Overview failure is not an observation');
  return persistExecutionSuccess(
    db,
    task,
    owner,
    overviewAnswer(result),
    async (trx, current, audit, artifactId) => {
      await appendObservation(trx, current, result, at);
      await derive(trx, current, audit, artifactId);
    },
    { surface: true, at },
  );
}

/** A failed overview keeps its observation as evidence and terminalizes the task without analysis. */
export function persistOverviewFailure(
  db: Database,
  task: AuditTask,
  owner: string,
  result: OverviewResult,
  runtime: AuditRuntime,
  options: { exchange: 'none' | 'unpaid' | 'paid'; at?: Date },
) {
  if (isOverviewObservation(result)) throw new Error('Overview observation is not a failure');
  const at = options.at ?? new Date();
  return persistSurfaceFailure(
    db,
    task,
    owner,
    new ProviderError(result.error_code || result.outcome),
    runtime,
    {
      exchange: options.exchange,
      at,
      record: {
        kind: 'observation',
        append: (trx, current) => appendObservation(trx, current, result, at),
      },
    },
  );
}

type SurfaceExchange = {
  taskId?: string | null;
  chargeMicrousd?: number | null;
  raw?: unknown;
  error?: ProviderError;
  poll?: boolean;
  reconciliation?: unknown;
  delaySeconds: number;
  uncertain?: boolean;
  paid?: boolean;
  resetPoll?: boolean;
};
/** Paid intent already committed. This phase records the exchange and parks without spending the retry budget. */
export function persistSurfaceExchange(
  db: Database,
  claimed: AuditTask,
  owner: string,
  exchange: SurfaceExchange,
  at = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    const locked = await ownedAuditTask(trx, claimed, owner);
    if (!locked) return false;
    const metadata = { ...record(locked.task.provider_metadata) };
    if (exchange.raw !== undefined) metadata.provider_submission_payload = exchange.raw;
    if (
      exchange.chargeMicrousd != null &&
      typeof metadata.provider_submission_cost_microusd !== 'number'
    )
      metadata.provider_submission_cost_microusd = exchange.chargeMicrousd;
    if (exchange.reconciliation !== undefined) metadata.reconciliation = exchange.reconciliation;
    const pollDelta = exchange.poll ? 1 : 0;
    const task = await trx
      .updateTable('audit_tasks')
      .set({
        provider_metadata: JSON.stringify(metadata),
        provider_task_id: exchange.taskId ?? locked.task.provider_task_id,
        provider_poll_count: exchange.resetPoll ? 0 : locked.task.provider_poll_count + pollDelta,
        attempt_count: locked.task.attempt_count + (exchange.paid ? 1 : 0),
        updated_at: at,
      })
      .where('id', '=', claimed.id)
      .where('workspace_id', '=', claimed.workspace_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await appendProviderAttempt(trx, task, at, {
      ...(exchange.error ? { error: exchange.error } : {}),
    });
    await parkAuditTask(
      trx,
      task,
      exchange.uncertain ? 'submission_uncertain' : 'awaiting_provider_result',
      new Date(at.getTime() + exchange.delaySeconds * 1000),
      at,
    );
    return true;
  });
}
