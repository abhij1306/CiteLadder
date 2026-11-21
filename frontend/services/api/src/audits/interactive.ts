import { policy, type ServiceConfig } from '../config.ts';
import { interactiveExecution } from '../config/execution.ts';
import { resolveSettingSpec } from '../config/settings.ts';
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
  stopping?: AbortSignal,
) {
  const env = config.settings;
  const runtime = auditRuntime(env);
  const timeout = AbortSignal.timeout(interactiveExecution.timeoutSeconds * 1000);
  const signal = stopping ? AbortSignal.any([timeout, stopping]) : timeout;
  runtime.audits.worker_concurrency = Math.min(
    runtime.audits.worker_concurrency,
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
    if (!(await worker.runOnce(signal))) break;
  }
}
