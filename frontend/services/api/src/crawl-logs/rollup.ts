import { randomUUID } from 'node:crypto';
import { sql, type Selectable, type Insertable } from 'kysely';
import type {
  CrawlLogSources,
  CrawlLogBatches,
  CrawlLogUploads,
  CrawlLogCoverageDaily,
} from '../generated/db-schema.ts';
import type { Database } from '../db/database.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { record, strings } from '../db/json.ts';
import { lockCrawlState, type CrawlScope } from './state.ts';
import type { Executor } from '../workers/executor.ts';
import { enqueueTrafficInsights } from './insights-enqueue.ts';
import { gapMinutes, pullCoverage } from './pull-coverage.ts';
import { isLiveKind } from './sources.ts';

/** Full recomputation under the project row lock prevents stale publication. */
export async function refreshCrawlLogs(
  db: Database,
  scope: CrawlScope,
  now = new Date(),
  reportingDates?: string[],
) {
  return await db.transaction().execute(async (trx) => {
    const state = await lockCrawlState(trx, scope);
    const tz = state.reporting_timezone;
    const cutoff = new Date(
      now.getTime() - (crawlLogs.retention_days - crawlLogs.rollup_freeze_margin_days) * 86400000,
    );
    const floor = sql<Date>`(${cutoff}::timestamptz at time zone ${tz})::date`;
    const selectedDay = reportingDates
      ? sql<boolean>`reporting_date=any(${reportingDates}::date[])`
      : sql<boolean>`true`;
    const span = [...(reportingDates ?? [])].sort((a, b) => a.localeCompare(b));
    // The occurred_at range lets the index bound the scan; the local-day test stays exact.
    let selectedRequest = sql<boolean>`true`;
    if (reportingDates)
      selectedRequest = sql<boolean>`(occurred_at at time zone ${tz})::date=any(${reportingDates}::date[])`;
    if (span.length)
      selectedRequest = sql<boolean>`${selectedRequest}
        and occurred_at >= (${span[0]}::date::timestamp at time zone ${tz})
        and occurred_at < ((${span.at(-1)}::date + 1)::timestamp at time zone ${tz})`;
    await trx
      .deleteFrom('bot_activity_daily')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('reporting_date', '>=', floor)
      .where(selectedDay)
      .execute();
    await sql`with input_rows as (
      select *,count(*) over(partition by workspace_id,project_id,(occurred_at at time zone ${tz})::date,bot_id,
        coalesce(url_hash,folder || ':' || resource_class),identity,url_hash,folder,resource_class,verification,status_code,verification_reason) as reason_count
      from bot_requests where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
        and occurred_at >= (${floor}::timestamp at time zone ${tz})
        and (occurred_at at time zone ${tz})::date >= ${floor} and ${selectedRequest}
      ) insert into bot_activity_daily (id,workspace_id,project_id,reporting_date,reporting_timezone,bot_id,identity_key,
      identity,url_hash,display_path,folder,resource_class,verification,status_code,requests,first_seen_at,last_seen_at,formula_version,source_batch_ids,verification_reasons,canonical_url)
      select gen_random_uuid(),workspace_id,project_id,(occurred_at at time zone ${tz})::date,${tz},bot_id,
        coalesce(url_hash,encode(sha256(convert_to(folder || ':' || resource_class,'UTF8')),'hex')),identity,url_hash,min(display_path),folder,resource_class,
        verification,status_code,count(*)::integer,min(occurred_at),max(occurred_at),${crawlLogs.formula_version},
        to_jsonb((array_agg(distinct batch_id order by batch_id))[1:${crawlLogs.max_source_batch_ids}]),
        jsonb_object_agg(coalesce(verification_reason,'verified'),reason_count),min(canonical_url)
      from input_rows
      group by 2,3,4,6,7,8,9,11,12,13,14`.execute(trx);
    await trx
      .deleteFrom('crawl_log_coverage_daily')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('reporting_date', '>=', floor)
      .where(selectedDay)
      .execute();
    const sources = await trx
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    let batchQuery = trx
      .selectFrom('crawl_log_batches')
      .select([
        'source_id',
        'received_at',
        'first_line_at',
        'last_line_at',
        'heartbeat',
        'drained',
        'catalog_version',
      ])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('status', '=', 'accepted')
      .where(sql<boolean>`(lines_matched>0 or lines_duplicate>0 or lines_unmatched>0 or heartbeat)`)
      .where('received_at', '>=', sql<Date>`${floor}::timestamp at time zone ${tz}`);
    // Only receipts received on, or carrying lines from, the refreshed days decide their coverage,
    // plus the settling drain a pull source needs after a refreshed day closes.
    if (span.length) {
      const from = sql<Date>`${span[0]}::date::timestamp at time zone ${tz}`,
        to = sql<Date>`(${span.at(-1)}::date + 1)::timestamp at time zone ${tz}`;
      batchQuery = batchQuery.where(
        sql<boolean>`((received_at >= ${from} and received_at < ${to})
          or (drained and received_at >= ${to} and received_at < ${to} + interval '1 day')
          or (first_line_at < ${to} and last_line_at >= ${from}))`,
      );
    }
    const batches = await batchQuery.execute();
    const uploads = await trx
      .selectFrom('crawl_log_uploads')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('updated_at', '>=', sql<Date>`${floor}::timestamp at time zone ${tz}`)
      .execute();
    // PostgreSQL supplies timezone-aware midnight boundaries, including DST days.
    const days = await sql<ReportingDay>`select to_char(d,'YYYY-MM-DD') as day,
      d::timestamp at time zone ${tz} as start,(d+interval '1 day')::timestamp at time zone ${tz} as end
      from generate_series(${floor},(${now}::timestamptz at time zone ${tz})::date,interval '1 day') d`.execute(
      trx,
    );
    const coverage = sources.flatMap((source) =>
      coverageRows(
        source,
        batches.filter((b) => b.source_id === source.id),
        uploads.filter((u) => u.source_id === source.id),
        days.rows.filter((day) => !reportingDates || reportingDates.includes(day.day)),
        now,
        tz,
        scope,
      ),
    );
    // Bound statements and serialize them on the same transaction connection.
    for (let i = 0; i < coverage.length; i += crawlLogs.insert_rows_per_statement)
      await trx
        .insertInto('crawl_log_coverage_daily')
        .values(coverage.slice(i, i + crawlLogs.insert_rows_per_statement))
        .execute();
    await trx
      .updateTable('crawl_log_sources')
      .set({ last_processed_at: now })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    await trx
      .updateTable('crawl_log_states')
      .set({ updated_at: now })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    await enqueueTrafficInsights(trx, scope, now);
  });
}
export const crawlLogRollupRefresh: Executor = async (task, { db, checkCancelled }) => {
  await checkCancelled('crawl-log-rollup');
  if (!task.project_id) throw new Error('Crawl rollup needs project');
  const dates = strings(record(task.payload).reporting_dates);
  if (!dates.length) throw new Error('Crawl rollup needs affected reporting dates');
  await refreshCrawlLogs(
    db,
    { workspaceId: task.workspace_id, projectId: task.project_id },
    new Date(),
    dates,
  );
};
type ReportingDay = { day: string; start: Date; end: Date };
type Source = Selectable<CrawlLogSources>;
type Batch = Pick<
  Selectable<CrawlLogBatches>,
  | 'source_id'
  | 'received_at'
  | 'first_line_at'
  | 'last_line_at'
  | 'heartbeat'
  | 'drained'
  | 'catalog_version'
>;
type Upload = Selectable<CrawlLogUploads>;
/**
 * The longest silence a complete day tolerates. A Firehose stream emits on its
 * buffer interval, so its bound is that interval plus a configured grace.
 */
function deliveryGapBound(source: Pick<Source, 'buffer_interval_seconds'>) {
  const buffered =
    source.buffer_interval_seconds === null
      ? 0
      : Math.ceil(source.buffer_interval_seconds / 60) + crawlLogs.buffered_delivery_grace_minutes;
  return Math.max(crawlLogs.max_delivery_gap_minutes, buffered);
}
function completeWebhook(source: Source, day: ReportingDay, now: Date, count: number, gap: number) {
  return (
    source.kind === 'webhook' &&
    count > 0 &&
    source.setup !== 'cloudflare_worker' &&
    record(source.sampling).kind === 'none' &&
    source.created_at <= day.start &&
    (!source.revoked_at || source.revoked_at >= day.end) &&
    day.end <= now &&
    gap <= deliveryGapBound(source)
  );
}
function coverageRows(
  source: Source,
  batches: Batch[],
  uploads: Upload[],
  days: ReportingDay[],
  now: Date,
  tz: string,
  scope: CrawlScope,
): Insertable<CrawlLogCoverageDaily>[] {
  const declarations = uploads.flatMap((u) =>
    Array.isArray(u.scanned_dates)
      ? u.scanned_dates.map((d) => ({
          date: record(d).date,
          complete: record(d).complete,
          status: u.status,
        }))
      : [],
  );
  return days.flatMap((day) => {
    const receipts = batches.filter((b) => b.received_at >= day.start && b.received_at < day.end);
    const evidence = batches.some(
      (b) =>
        b.first_line_at &&
        b.last_line_at &&
        b.first_line_at < day.end &&
        b.last_line_at >= day.start,
    );
    const scans = declarations.filter((d) => d.date === day.day);
    if (source.kind === 'upload' && !evidence && !scans.length && !receipts.length) return [];
    if (
      isLiveKind(source.kind) &&
      (source.created_at >= day.end || (source.revoked_at && source.revoked_at <= day.start))
    )
      return [];
    const { decision, gap } =
      source.kind === 'pull'
        ? pullCoverage(source, batches, day)
        : liveCoverage(source, day, now, receipts, evidence, scans);
    return [
      {
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        source_id: source.id,
        reporting_date: day.day,
        reporting_timezone: tz,
        ...decision,
        batch_count: receipts.length,
        heartbeat_count: receipts.filter((b) => b.heartbeat).length,
        max_gap_minutes: gap,
      },
    ];
  });
}
/** A webhook or upload day: the decision and the longest wait between receipts. */
function liveCoverage(
  source: Source,
  day: ReportingDay,
  now: Date,
  receipts: Batch[],
  evidence: boolean,
  scans: { status: string; complete: unknown }[],
) {
  const gap = gapMinutes(
    receipts.map((b) => b.received_at),
    day,
  );
  return {
    decision: coverageDecision(source, day, now, receipts.length, gap, evidence, scans),
    gap,
  };
}
function coverageDecision(
  source: Source,
  day: ReportingDay,
  now: Date,
  count: number,
  gap: number,
  evidence: boolean,
  scans: { status: string; complete: unknown }[],
) {
  if (source.setup === 'cloudflare_worker' && (count || evidence || scans.length))
    return { coverage: 'partial', reason: 'best_effort_worker' };
  if (completeWebhook(source, day, now, count, gap))
    return { coverage: 'complete', reason: 'unsampled_gap_free_declared_scope' };
  if (scans.some((d) => d.status === 'completed' && d.complete === true))
    return { coverage: 'declared_complete', reason: 'client_reported' };
  if (count || evidence || scans.length)
    return { coverage: 'partial', reason: 'delivery_gaps_or_partial_scan' };
  return { coverage: 'unknown', reason: 'no_data' };
}
