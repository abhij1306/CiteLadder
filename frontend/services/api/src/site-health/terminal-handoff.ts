/** The exactly-once analytics handoff owed by a terminal crawl's persisted evidence. */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { announceEvidence } from '../opportunities/evidence-announcement.ts';
import { enqueueTask, enqueueCoalesced } from '../queue/enqueue.ts';
import type { Crawl } from './site-task.ts';
import { insightsRefresh } from '../config/ai-traffic.ts';

/**
 * Enqueue analytics after change persistence, or with the crawl's own identity
 * when the crawl produced no usable analysis. A project with Traffic evidence
 * re-interprets Demand first and carries the trigger to Demand's Opportunity
 * refresh; a site-only project refreshes Opportunities directly.
 */
export async function enqueueTerminalAnalyticsRefresh(
  db: Database,
  crawl: Crawl,
  changeSnapshotId: string | null,
) {
  const scope = { workspaceId: crawl.workspace_id, projectId: crawl.project_id };
  const triggerKind = changeSnapshotId ? 'site_change' : 'site_crawl';
  await enqueueCoalesced(db, { ...insightsRefresh, ...scope });
  const triggerId = changeSnapshotId ?? crawl.id;
  const traffic = await db
    .selectFrom('traffic_snapshots')
    .select([
      isoDateText(sql.ref('window_start')).as('start'),
      isoDateText(sql.ref('window_end')).as('end'),
    ])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('granularity', '=', policy.traffic.TRAFFIC_GRANULARITY_DAY)
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  await announceEvidence(
    db,
    scope,
    { kind: 'site_crawl', id: crawl.id },
    // With Traffic evidence, Demand re-interprets first and carries the refresh.
    { refresh: traffic ? null : { kind: triggerKind, id: triggerId } },
  );
  if (!traffic) return;
  // Demand keys a revision by its first 24 characters.
  const revision = `${triggerKind}:${triggerId}`.slice(0, 24);
  await enqueueTask(db, {
    ...scope,
    kind: 'demand_snapshot_refresh',
    payload: {
      window_start: traffic.start,
      window_end: traffic.end,
      source_revision: revision,
      manual: false,
      downstream_trigger_kind: triggerKind,
      downstream_trigger_id: triggerId,
    },
    keyParts: [crawl.project_id, traffic.start, traffic.end, 0, revision],
  });
}
