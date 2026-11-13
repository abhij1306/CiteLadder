import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { enqueueCoalesced } from '../queue/enqueue.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { strings } from '../db/json.ts';
import { reportingDay } from '../calendar-days.ts';

export type CrawlScope = { workspaceId: string; projectId: string };
function affectedDays(now: Date, timeZone: string, first?: Date | null, last?: Date | null) {
  const days = [
    reportingDay(now, timeZone),
    reportingDay(new Date(now.getTime() - 86400000), timeZone),
  ];
  if (first && last)
    for (
      let date = Date.parse(reportingDay(first, timeZone));
      date <= Date.parse(reportingDay(last, timeZone));
      date += 86400000
    )
      days.push(new Date(date).toISOString().slice(0, 10));
  return days;
}
/** All ingestion, source mutations and rollup publication serialize here. */
export async function lockCrawlState(db: Database, scope: CrawlScope) {
  await db
    .insertInto('crawl_log_states')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      reporting_timezone: crawlLogs.default_reporting_timezone,
      updated_at: new Date(),
    })
    .onConflict((c) => c.constraint('uq_crawl_log_state_project').doNothing())
    .execute();
  return db
    .selectFrom('crawl_log_states')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
/**
 * Adopt the reporting timezone a GA4 property reports in. A change re-rolls
 * every retained day in the new timezone; the same timezone is a no-op.
 */
export async function adoptReportingTimezone(
  db: Database,
  scope: CrawlScope,
  timeZone: string,
): Promise<void> {
  const state = await lockCrawlState(db, scope);
  if (state.reporting_timezone === timeZone) return;
  await db
    .updateTable('crawl_log_states')
    .set({ reporting_timezone: timeZone })
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
  const now = new Date();
  await enqueueRollup(db, scope, now, {
    first: new Date(now.getTime() - (crawlLogs.retention_days - 1) * 86400000),
    last: now,
  });
}
/** Rollups coalesce: queued work merges the affected reporting days; leased work gets a successor. */
export async function enqueueRollup(
  db: Database,
  scope: CrawlScope,
  now: Date,
  span: { first?: Date | null; last?: Date | null } = {},
) {
  const state = await db
    .selectFrom('crawl_log_states')
    .select('reporting_timezone')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirstOrThrow();
  const dates = affectedDays(now, state.reporting_timezone, span.first, span.last);
  const floor = reportingDay(
    new Date(
      now.getTime() - (crawlLogs.retention_days - crawlLogs.rollup_freeze_margin_days) * 86400000,
    ),
    state.reporting_timezone,
  );
  const reportingDates = (queued: readonly string[]) =>
    [...new Set([...queued, ...dates])]
      .filter((day) => day >= floor)
      .sort((a, b) => a.localeCompare(b));
  await enqueueCoalesced(db, {
    ...scope,
    kind: 'crawl_log_rollup_refresh',
    payload: { reporting_dates: reportingDates([]) },
    merge: (queued) => ({ reporting_dates: reportingDates(strings(queued.reporting_dates)) }),
    delaySeconds: crawlLogs.refresh_delay_seconds,
    maxAttempts: crawlLogs.task_max_attempts,
    now,
  });
}
