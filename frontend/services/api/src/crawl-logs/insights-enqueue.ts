import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import type { CrawlScope } from './state.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { aiTraffic } from '../config/ai-traffic.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { ga4Mapped } from './pages.ts';

/** Called inside terminal/source transactions; leased work gets a queued successor.
 * Every pattern needs referral evidence, so projects without GA4 enqueue nothing. */
export async function enqueueTrafficInsights(db: Database, scope: CrawlScope, now = new Date()) {
  if (!(await ga4Mapped(db, scope))) return;
  await sql`select pg_advisory_xact_lock(hashtextextended(${scope.workspaceId + ':' + scope.projectId + ':ai-traffic-insights'},0))`.execute(
    db,
  );
  const pending = await db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('task_kind', '=', 'ai_traffic_insights_refresh')
    .where('status', '=', 'queued')
    .forUpdate()
    .executeTakeFirst();
  if (pending) {
    await db
      .updateTable('analytics_tasks')
      .set({
        available_at: sql<Date>`least(available_at, ${new Date(now.getTime() + aiTraffic.refresh_delay_seconds * 1000)}::timestamptz)`,
      })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', pending.id)
      .execute();
    return;
  }
  const id = await enqueueTask(db, {
    ...scope,
    kind: 'ai_traffic_insights_refresh',
    payload: {},
    keyParts: [scope.projectId, randomUUID()],
    maxAttempts: crawlLogs.task_max_attempts,
  });
  if (id)
    await db
      .updateTable('analytics_tasks')
      .set({ available_at: new Date(now.getTime() + aiTraffic.refresh_delay_seconds * 1000) })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', id)
      .execute();
}
