import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { enqueueContentAngles } from '../content-gaps/enqueue.ts';
import { announceEvidence } from '../opportunities/evidence-announcement.ts';
import { enqueueTask, enqueueCoalesced } from '../queue/enqueue.ts';
import type { Crawl } from './site-task.ts';
import { insightsRefresh } from '../config/ai-traffic.ts';

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
    { refresh: traffic ? null : { kind: triggerKind, id: triggerId } },
  );
  await enqueueContentAngles(db, scope, { kind: 'site_crawl', id: crawl.id });
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
