import { setTimeout as sleep } from 'node:timers/promises';
import { configEnvironment, type ServiceConfig } from '../config.ts';
import { interactiveExecution } from '../config/execution.ts';
import type { Database } from '../db/database.ts';
import { leaseSignal } from '../queue/heartbeat.ts';
import { IntegrationWorker } from '../workers/integration-worker.ts';
import { IntegrationClient } from './client.ts';
import { freshAccessToken } from './tokens.ts';

export async function executeInteractiveSyncs(
  db: Database,
  config: ServiceConfig,
  workspaceId: string,
  connectionId: string,
  target: { runId?: string; mappingId?: string },
) {
  if (!target.runId && !target.mappingId) return;
  const signal = AbortSignal.timeout(interactiveExecution.timeoutSeconds * 1000);
  const client = new IntegrationClient(configEnvironment(config), {
    fetch: (url, init) => fetch(url, { ...init, signal: leaseSignal(signal, init?.signal) }),
    sleep: (ms) => sleep(ms, undefined, { signal }),
  });
  let query = db
    .selectFrom('integration_sync_runs')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('connection_id', '=', connectionId)
    .where('status', 'in', ['queued', 'retry_wait'])
    .where('available_at', '<=', new Date())
    .whereRef('attempt_count', '<', 'max_attempts');
  if (target.runId) query = query.where('id', '=', target.runId);
  if (target.mappingId) query = query.where('mapping_id', '=', target.mappingId);
  const rows = await query
    .orderBy('window_end', 'desc')
    .orderBy('available_at')
    .limit(interactiveExecution.concurrency)
    .execute();
  const deadline = performance.now() + interactiveExecution.admissionSeconds * 1000;
  for (const row of rows) {
    if (signal.aborted || performance.now() >= deadline) break;
    const worker = new IntegrationWorker(
      db,
      client,
      client.settings,
      (database, grantId, workspace, _client, rejected) =>
        freshAccessToken(database, grantId, workspace, client, rejected),
      { workspaceId, runId: row.id },
    );
    await worker.runOnce(signal);
  }
}
