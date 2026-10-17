import { configEnvironment, loadWorkerSettings, type ServiceConfig } from '../config.ts';
import { interactiveExecution } from '../config/execution.ts';
import type { Database } from '../db/database.ts';
import { fetchWebsite } from '../projects/safe-fetch.ts';
import { leaseSignal } from '../queue/heartbeat.ts';
import { AnalyticsWorker } from '../workers/analytics-worker.ts';
import { exclusiveDrain } from '../workers/runner.ts';
import { competitorDiscovery } from './discovery.ts';
import { competitorSearch } from './discovery-provider.ts';
import { discoveries, type CommerceScope } from './reads.ts';

export async function executeCompetitorDiscoveries(
  db: Database,
  config: ServiceConfig,
  scope: CommerceScope,
  taskIds: string[],
) {
  await discoveries(db, scope, taskIds);
  const env = configEnvironment(config);
  const signal = AbortSignal.timeout(interactiveExecution.timeoutSeconds * 1000);
  const worker = new AnalyticsWorker(
    db,
    {
      ...loadWorkerSettings(env),
      drainBudgetSeconds: interactiveExecution.admissionSeconds,
    },
    {
      taskScope: { workspaceId: scope.workspaceId, taskIds },
      signal,
      executors: {
        commerce_competitor_discovery: competitorDiscovery({
          search: competitorSearch(env, (url, init) =>
            fetch(url, { ...init, signal: leaseSignal(signal, init?.signal) }),
          ),
          fetcher: (url, options) =>
            fetchWebsite(url, { ...options, signal: leaseSignal(signal, options.signal) }),
        }),
      },
    },
  );
  await exclusiveDrain(
    config,
    {
      signal,
      deadline: performance.now() + interactiveExecution.admissionSeconds * 1000,
    },
    0,
  )(() => worker.runUntilIdle(taskIds.length, signal));
  return discoveries(db, scope, taskIds);
}
