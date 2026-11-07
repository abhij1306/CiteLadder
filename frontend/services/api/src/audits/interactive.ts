import { configEnvironment, policy, resolveSettingSpec, type ServiceConfig } from '../config.ts';
import { interactiveExecution } from '../config/execution.ts';
import type { Database } from '../db/database.ts';
import { AuditWorker } from './worker.ts';
import { configuredShelfResolver } from '../commerce/shelf.ts';
import { auditRuntime } from './config.ts';
import { auditProjections } from './projections.ts';

export async function executeInteractiveAudit(
  db: Database,
  config: ServiceConfig,
  workspaceId: string,
  auditId: string,
  /** Stops the drive early, e.g. on shutdown; the runner continues the audit. */
  stopping?: AbortSignal,
) {
  const env = configEnvironment(config);
  const runtime = auditRuntime(env);
  const timeout = AbortSignal.timeout(interactiveExecution.timeoutSeconds * 1000);
  const signal = stopping ? AbortSignal.any([timeout, stopping]) : timeout;
  runtime.audits.worker_concurrency = Math.min(
    runtime.audits.worker_concurrency,
    config.execution.poolSize,
    interactiveExecution.concurrency,
  );
  const worker = new AuditWorker(
    db,
    runtime,
    String(resolveSettingSpec(policy.settings.encryption_key, env)),
    auditProjections(db, configuredShelfResolver(env, signal) ?? null, env),
    { taskScope: { workspaceId, auditId } },
  );
  const deadline = performance.now() + interactiveExecution.admissionSeconds * 1000;
  while (!signal.aborted && performance.now() < deadline) {
    // Each claim advances a persisted phase; future polls keep their due time.
    if (!(await worker.runOnce(signal))) break;
  }
}
