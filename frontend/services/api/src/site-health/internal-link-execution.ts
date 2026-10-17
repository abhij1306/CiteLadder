/** Request-bound execution of one authorized analysis through the existing queue owner. */
import { sql } from 'kysely';
import { configEnvironment, loadWorkerSettings, policy, type ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { createJevClient, jevSettings } from '../models/jev.ts';
import { AnalyticsWorker } from '../workers/analytics-worker.ts';
import { internalLinkJudge } from './internal-link-judgments.ts';
import { publishInternalLinks } from './internal-link-publish.ts';
import type { LinkScope } from './internal-link-pages.ts';

export async function executeLinkRun(
  db: Database,
  config: ServiceConfig,
  scope: LinkScope,
  runId: string,
) {
  const env = configEnvironment(config);
  const settings = loadWorkerSettings(env);
  const tasks = (kind: string) =>
    db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('task_kind', '=', kind)
      .where(sql<string>`payload ->> 'run_id'`, '=', runId)
      .execute();
  const run = async (kind: string, executor: typeof publishInternalLinks) => {
    const rows = await tasks(kind);
    const worker = new AnalyticsWorker(db, settings, {
      taskScope: { workspaceId: scope.workspaceId, taskIds: rows.map((row) => row.id) },
      executors: { [kind]: executor },
    });
    // A fixed list bounds this pass; leases exclude concurrent requests and the runner.
    await worker.runUntilIdle(rows.length);
  };
  await run(
    'internal_link_judgment',
    internalLinkJudge(() => createJevClient(jevSettings(env)), {
      ...policy.internal_links,
      job_deadline_seconds: policy.internal_links.interactive_deadline_seconds,
    }),
  );
  // Publication tasks are committed successors and need no second cold job start.
  // Keep work observation active so further successors still wake the background runner.
  await run('internal_link_publish', publishInternalLinks);
}
