import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { Audits } from '../generated/db-schema.ts';
import { normalizedUsage, type Answer } from '../answer-engines/contracts.ts';
import { ProviderError } from '../providers/errors.ts';
import type { Engine, ProviderTransport } from '../providers/config.ts';
import { ownedAuditTask, parkAuditTask, type AuditTask } from '../queue/audit-queue.ts';
import { appendCostProjection } from './costs.ts';
import { auditPolicy, type AuditRuntime } from './config.ts';
import { auditEvent } from './state.ts';
import { pauseExecutionCredential, type ExecutionContext } from './execution-context.ts';

export type ExecutionResult = Omit<Answer, 'logical_engine' | 'transport_provider'> & {
  logical_engine: Engine;
  transport_provider: ProviderTransport;
};
export type DeriveExecution = (
  db: Database,
  task: AuditTask,
  audit: Selectable<Audits>,
  artifactId: string,
) => Promise<void>;

/** Evidence numbering counts every exchange; surface polling never spends the paid retry budget. */
export async function appendProviderAttempt(
  db: Database,
  task: AuditTask,
  at: Date,
  facts: {
    artifactId?: string;
    error?: ProviderError;
    latencyMs?: number;
  },
) {
  const count = await db
    .selectFrom('provider_attempts')
    .select(sql<string>`count(*)`.as('count'))
    .where('audit_id', '=', task.audit_id)
    .where('task_id', '=', task.id)
    .executeTakeFirstOrThrow();
  return db
    .insertInto('provider_attempts')
    .values({
      id: randomUUID(),
      audit_id: task.audit_id,
      task_id: task.id,
      attempt_number: Number(count.count) + 1,
      logical_engine: task.logical_engine,
      transport_provider: task.transport_provider,
      transport_model: task.transport_model,
      status: facts.error ? 'failed' : 'succeeded',
      error_code: facts.error?.code ?? '',
      error_detail: facts.error ? `Provider execution failed: ${facts.error.code}` : '',
      artifact_id: facts.artifactId ?? null,
      latency_ms: facts.latencyMs ?? null,
      created_at: at,
    })
    .execute();
}

function retryDelay(runtime: AuditRuntime, attempt: number, retryAfter?: number) {
  const settings = runtime.audits;
  if (retryAfter !== undefined && Number.isFinite(retryAfter))
    return Math.min(Math.max(0, retryAfter), settings.retry_max_delay_seconds);
  return (
    Math.min(settings.retry_base_delay_seconds * 2 ** attempt, settings.retry_max_delay_seconds) +
    ((attempt * 0.37) % 1) * settings.retry_jitter_seconds
  );
}

/** Artifact, analysis, attempts, cost, event and terminal queue state share one commit. */
export function persistExecutionSuccess(
  db: Database,
  claimed: AuditTask,
  owner: string,
  result: ExecutionResult,
  derive: DeriveExecution,
  options: { surface?: boolean; at?: Date } = {},
) {
  const at = options.at ?? new Date();
  if (
    result.logical_engine !== claimed.logical_engine ||
    result.transport_provider !== claimed.transport_provider ||
    result.transport_model !== claimed.transport_model
  )
    throw new Error('Execution route mismatch');
  return db.transaction().execute(async (trx) => {
    const locked = await ownedAuditTask(trx, claimed, owner);
    if (!locked) return null;
    const artifactId = randomUUID();
    const previous = record(locked.task.provider_metadata);
    const reported = previous.provider_submission_cost_microusd;
    const usage = {
      ...normalizedUsage(result.normalized_usage),
      ...(options.surface && typeof reported === 'number'
        ? { provider_cost_microusd: reported }
        : {}),
    };
    const metadata = { ...previous, ...result.provider_metadata };
    const artifact = {
      id: artifactId,
      audit_id: claimed.audit_id,
      task_id: claimed.id,
      logical_engine: result.logical_engine,
      transport_provider: result.transport_provider,
      transport_model: result.transport_model,
      answer_text: result.answer_text,
      search_used: result.search_used,
      search_events: JSON.stringify(result.search_events),
      citations: JSON.stringify(result.citations),
      retrieved_sources:
        result.retrieved_sources === null ? null : JSON.stringify(result.retrieved_sources),
      provider_metadata: JSON.stringify(metadata),
      usage: JSON.stringify(usage),
      finish_reason: result.finish_reason,
      raw_finish_reason: result.raw_finish_reason,
      latency_ms: result.latency_ms,
      created_at: at,
    };
    await trx.insertInto('raw_response_artifacts').values(artifact).execute();
    const task = await trx
      .updateTable('audit_tasks')
      .set({
        status: 'succeeded',
        attempt_count: locked.task.attempt_count + (options.surface ? 0 : 1),
        answer_text: result.answer_text,
        search_used: result.search_used,
        search_events: artifact.search_events,
        citations: artifact.citations,
        provider_metadata: artifact.provider_metadata,
        finish_reason: result.finish_reason,
        raw_finish_reason: result.raw_finish_reason,
        latency_ms: result.latency_ms,
        result_artifact_id: artifactId,
        error_code: '',
        error_detail: '',
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        completed_at: at,
        updated_at: at,
      })
      .where('id', '=', claimed.id)
      .where('workspace_id', '=', claimed.workspace_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await appendProviderAttempt(trx, task, at, { artifactId, latencyMs: result.latency_ms });
    await derive(trx, task, locked.audit, artifactId);
    await appendCostProjection(trx, task.workspace_id, artifactId);
    await auditEvent(
      trx,
      task.audit_id,
      auditPolicy.constants.event_task_succeeded,
      'task succeeded',
      { task_id: task.id },
      at,
    );
    return artifactId;
  });
}

async function insertFailureArtifact(
  db: Database,
  claimed: AuditTask,
  artifactId: string,
  metadata: Record<string, unknown>,
  at: Date,
) {
  await db
    .insertInto('raw_response_artifacts')
    .values({
      id: artifactId,
      audit_id: claimed.audit_id,
      task_id: claimed.id,
      logical_engine: claimed.logical_engine,
      transport_provider: claimed.transport_provider,
      transport_model: claimed.transport_model,
      answer_text: '',
      search_used: false,
      search_events: null,
      citations: null,
      finish_reason: 'unknown',
      raw_finish_reason: '',
      latency_ms: null,
      provider_metadata: JSON.stringify(metadata),
      usage:
        typeof metadata.provider_submission_cost_microusd === 'number'
          ? JSON.stringify({
              provider_cost_microusd: metadata.provider_submission_cost_microusd,
            })
          : null,
      created_at: at,
    })
    .execute();
}
/** How one failure settles: what it spends, records and may retry. Built only by the exported writers. */
type FailurePlan = {
  spendsAttempt: boolean;
  mayRetry: boolean;
  recordsAttempt: boolean;
  /** A failed scraper exchange keeps its own immutable artifact with this outcome. */
  artifactOutcome: string | null;
  evidence: ((db: Database, task: AuditTask) => Promise<void>) | null;
  context: ExecutionContext | undefined;
  at: Date;
};
function failureMetadata(
  providerMetadata: unknown,
  artifactOutcome: string | null,
): Record<string, unknown> {
  return {
    ...record(providerMetadata),
    ...(artifactOutcome ? { scraper_outcome: artifactOutcome, raw_response: {} } : {}),
  };
}
async function markTaskFailed(db: Database, task: AuditTask, at: Date) {
  await db
    .updateTable('audit_tasks')
    .set({
      status: 'failed',
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      completed_at: at,
    })
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .execute();
}
/**
 * An answer-engine failure. Before any call (`called: false`) it terminalizes the task
 * without inventing a provider attempt or debit; after a call it spends an attempt and a
 * retryable error parks the task for retry within its budget.
 */
export function persistAnswerFailure(
  db: Database,
  claimed: AuditTask,
  owner: string,
  error: ProviderError,
  runtime: AuditRuntime,
  options: { called: boolean; context?: ExecutionContext; at?: Date },
) {
  return persistFailure(db, claimed, owner, error, runtime, {
    spendsAttempt: options.called,
    mayRetry: options.called,
    recordsAttempt: options.called,
    artifactOutcome: null,
    evidence: null,
    context: options.context,
    at: options.at ?? new Date(),
  });
}

/** What an observed surface's failure keeps beside the task: a failure artifact or its own observation. */
export type SurfaceFailureRecord =
  | { kind: 'failure_artifact'; outcome: string }
  | { kind: 'observation'; append: (db: Database, task: AuditTask) => Promise<void> };
/**
 * An observed surface's failure is terminal: provider recovery already happened through
 * polling and reconciliation. `exchange` says what reached the provider: nothing, a free
 * retrieval, or the paid submission (the only exchange that spends an attempt).
 */
export function persistSurfaceFailure(
  db: Database,
  claimed: AuditTask,
  owner: string,
  error: ProviderError,
  runtime: AuditRuntime,
  options: {
    exchange: 'none' | 'unpaid' | 'paid';
    record: SurfaceFailureRecord;
    context?: ExecutionContext | null;
    at?: Date;
  },
) {
  const { record: evidence } = options;
  return persistFailure(db, claimed, owner, error, runtime, {
    spendsAttempt: options.exchange === 'paid',
    mayRetry: false,
    recordsAttempt: options.exchange !== 'none',
    artifactOutcome: evidence.kind === 'failure_artifact' ? evidence.outcome : null,
    evidence: evidence.kind === 'observation' ? evidence.append : null,
    context: options.context ?? undefined,
    at: options.at ?? new Date(),
  });
}

function persistFailure(
  db: Database,
  claimed: AuditTask,
  owner: string,
  error: ProviderError,
  runtime: AuditRuntime,
  plan: FailurePlan,
) {
  return db.transaction().execute(async (trx) => {
    const locked = await ownedAuditTask(trx, claimed, owner);
    if (!locked) return null;
    const attempt = locked.task.attempt_count + (plan.spendsAttempt ? 1 : 0);
    const retry = plan.mayRetry && error.retryable && attempt < locked.task.max_attempts;
    const failure = { error, attempt, retry };
    const task = await recordFailedAttempt(trx, claimed, locked.task, failure, plan);
    await plan.evidence?.(trx, task);
    await settleFailedTask(trx, task, failure, runtime, plan);
    return { retry, attempt };
  });
}
type Failure = { error: ProviderError; attempt: number; retry: boolean };
/** Writes the failed attempt: optional scraper artifact, task row, attempt and cost projection. */
async function recordFailedAttempt(
  trx: Database,
  claimed: AuditTask,
  current: AuditTask,
  { error, attempt }: Failure,
  plan: FailurePlan,
) {
  const at = plan.at;
  const failureArtifactId = plan.artifactOutcome ? randomUUID() : null;
  const metadata = failureMetadata(current.provider_metadata, plan.artifactOutcome);
  if (failureArtifactId) await insertFailureArtifact(trx, claimed, failureArtifactId, metadata, at);
  const task = await trx
    .updateTable('audit_tasks')
    .set({
      attempt_count: attempt,
      error_code: error.code,
      error_detail: `Provider execution failed: ${error.code}`,
      updated_at: at,
      ...(failureArtifactId
        ? { result_artifact_id: failureArtifactId, provider_metadata: JSON.stringify(metadata) }
        : {}),
    })
    .where('id', '=', claimed.id)
    .where('workspace_id', '=', claimed.workspace_id)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (plan.recordsAttempt)
    await appendProviderAttempt(trx, task, at, {
      error,
      ...(failureArtifactId ? { artifactId: failureArtifactId } : {}),
    });
  if (failureArtifactId) await appendCostProjection(trx, task.workspace_id, failureArtifactId);
  return task;
}
/** Pauses a failed credential, then parks for retry or terminalizes. */
async function settleFailedTask(
  trx: Database,
  task: AuditTask,
  { error, attempt, retry }: Failure,
  runtime: AuditRuntime,
  { context, at }: FailurePlan,
) {
  if (error.code === 'auth_failure' && context)
    await pauseExecutionCredential(trx, context, runtime, at);
  if (retry)
    await parkAuditTask(
      trx,
      task,
      'retry_wait',
      new Date(at.getTime() + retryDelay(runtime, attempt, error.retryAfterSeconds) * 1000),
      at,
    );
  else await markTaskFailed(trx, task, at);
  await auditEvent(
    trx,
    task.audit_id,
    retry ? auditPolicy.constants.event_task_retry : auditPolicy.constants.event_task_failed,
    retry ? 'task retry' : 'task failed',
    { task_id: task.id, error_code: error.code },
    at,
  );
}
