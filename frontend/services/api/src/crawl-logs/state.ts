import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { policy } from '../config.ts';
import { record, strings } from '../db/json.ts';

export type CrawlScope = { workspaceId: string; projectId: string };
const dayFormats = new Map<string, Intl.DateTimeFormat>();
export function reportingDay(at: Date, timeZone: string) {
  if (timeZone === 'UTC') return at.toISOString().slice(0, 10);
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(at);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
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
/** A queued successor is reusable; leased/running work always gets a new successor. */
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
  const pending = await db
    .selectFrom('analytics_tasks')
    .select(['id', 'payload'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('task_kind', '=', 'crawl_log_rollup_refresh')
    .where('status', '=', policy.task_queue.statuses.queued)
    .forUpdate()
    .executeTakeFirst();
  const reportingDates = [
    ...new Set([...strings(record(pending?.payload).reporting_dates), ...dates]),
  ]
    .filter((day) => day >= floor)
    .sort((a, b) => a.localeCompare(b));
  if (pending) {
    await db
      .updateTable('analytics_tasks')
      .set({ payload: JSON.stringify({ reporting_dates: reportingDates }) })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', pending.id)
      .execute();
    return;
  }
  const id = await enqueueTask(db, {
    ...scope,
    kind: 'crawl_log_rollup_refresh',
    payload: { reporting_dates: reportingDates },
    keyParts: [scope.projectId, randomUUID()],
    maxAttempts: crawlLogs.task_max_attempts,
  });
  if (id)
    await db
      .updateTable('analytics_tasks')
      .set({
        available_at: new Date(now.getTime() + crawlLogs.refresh_delay_seconds * 1000),
      })
      .where('id', '=', id)
      .where('workspace_id', '=', scope.workspaceId)
      .execute();
}
