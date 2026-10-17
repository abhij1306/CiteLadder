import { configEnvironment, policy, resolveSettingSpec, type ServiceConfig } from '../config.ts';
import { interactiveExecution } from '../config/execution.ts';
import type { Database } from '../db/database.ts';
import { AuditWorker } from '../workers/audit-worker.ts';
import { configuredShelfResolver } from '../commerce/shelf.ts';
import { auditRuntime } from './config.ts';
import { auditProjections } from './projections.ts';

export async function executeInteractiveAudit(
  db: Database,
  config: ServiceConfig,
  workspaceId: string,
  auditId: string,
) {
  const env = configEnvironment(config);
  const runtime = auditRuntime(env);
  const signal = AbortSignal.timeout(interactiveExecution.timeoutSeconds * 1000);
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
    { env, taskScope: { workspaceId, auditId } },
  );
  const deadline = performance.now() + interactiveExecution.admissionSeconds * 1000;
  while (!signal.aborted && performance.now() < deadline) {
    // Each claim advances a persisted phase; future polls keep their due time.
    if (!(await worker.runOnce(signal))) break;
  }
}
