/** The project dashboard: the selected crawl, its counters, the quota and the screen phase. */
import { siteHealthDashboardSchema } from '@citeladder/contracts/site-health';

import type { Database } from '../../db/database.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import { notFound } from '../../errors.ts';
import {
  crawlCounters,
  loadProject,
  projectCrawl,
  rootFailure,
  scoreSummary,
  type Crawl,
} from './crawl.ts';
import { monitoredQuota } from './runtime.ts';

const TERMINAL_DISCOVERY = new Set([
  'completed',
  'sample_completed',
  'failed',
  'cancelled',
  'stopped',
]);
type Phase = 'empty' | 'discovering' | 'analyzing' | 'dashboard' | 'terminal';

/**
 * The screen phase, resolved once from every input at the same instant so the
 * client never flips between views while its requests land.
 */
export function resolvePhase(
  crawl: Crawl | null,
  summary: ReturnType<typeof scoreSummary>,
  hasMonitoredSelection: boolean,
): Phase {
  if (crawl === null) return 'empty';
  if (crawl.status === 'completed' || crawl.status === 'partially_completed') return 'dashboard';
  // Real partial scores outrank a failure; a present-but-unscored summary does not.
  const scored =
    summary !== null &&
    (summary.web_fundamentals_state !== 'not_measured' ||
      summary.aeo_measurement_state !== 'not_measured');
  if (scored) return 'dashboard';
  if (crawl.status === 'failed' || crawl.status === 'cancelled' || crawl.status === 'paused')
    return 'terminal';
  // A committed monitored set seeds analysis at creation; `analysis_status`
  // only lags until the first reconcile.
  if (hasMonitoredSelection) return 'analyzing';
  return TERMINAL_DISCOVERY.has(crawl.discovery_status) ? 'analyzing' : 'discovering';
}

export async function dashboard(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
) {
  await loadProject(db, workspaceId, projectId);
  const workspace = new WorkspaceScope(workspaceId);
  let crawls = workspace
    .selectFrom(db, 'site_crawls')
    .selectAll()
    .where('project_id', '=', projectId);
  crawls = crawlId === null ? crawls : crawls.where('id', '=', crawlId);
  const crawl =
    (await crawls.orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst()) ?? null;
  if (crawl === null && crawlId !== null) throw notFound('Crawl');
  const [quota, projectMonitored, details, snapshot] = await Promise.all([
    monitoredQuota(db, workspaceId),
    workspace
      .selectFrom(db, 'monitored_site_urls')
      .select('id')
      .where('project_id', '=', projectId)
      .where('active', '=', true)
      .executeTakeFirst(),
    crawl ? Promise.all([rootFailure(db, crawl), crawlCounters(db, crawl)]) : null,
    crawl
      ? workspace
          .selectFrom(db, 'site_health_snapshots')
          .select('id')
          .where('crawl_id', '=', crawl.id)
          .executeTakeFirst()
      : undefined,
  ]);
  const summary = crawl ? scoreSummary(crawl) : null;
  const [root, counters] = details ?? [{ summary: null, errors: [] }, undefined];
  return siteHealthDashboardSchema.parse({
    project_id: projectId,
    crawl: crawl ? projectCrawl(crawl, { failureSummary: root.summary, counters }) : null,
    score_summary: summary,
    snapshot_id: snapshot?.id ?? null,
    phase: resolvePhase(crawl, summary, projectMonitored !== undefined),
    quota,
    root_errors: root.errors,
  });
}
