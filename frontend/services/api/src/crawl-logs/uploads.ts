import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { ApiError, notFound } from '../errors.ts';
import { lockCrawlState, enqueueRollup, type CrawlScope } from './state.ts';
import { requireCrawlLogs } from './sources.ts';
import { lockAuthorizedWorkspace } from '../workspaces/service.ts';

export const uploadCreateSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  size_bytes: z.int().nonnegative(),
});
export const uploadBatchSchema = z.strictObject({
  seq: z.int().nonnegative(),
  lines: z.array(z.string().max(crawlLogs.max_line_bytes)).max(crawlLogs.max_lines_per_batch),
});
export const uploadCompleteSchema = z.strictObject({
  scanned_lines: z.int().nonnegative(),
  first_line_at: z.iso.datetime({ offset: true }).nullable(),
  last_line_at: z.iso.datetime({ offset: true }).nullable(),
  scanned_dates: z.array(z.iso.date()).max(crawlLogs.max_backdate_days + 1),
});
export async function sourceForUpload(db: Database, scope: CrawlScope, id: string) {
  const source = await db
    .selectFrom('crawl_log_sources')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!source) throw notFound('Crawl log source');
  if (source.status !== 'active' || source.kind !== 'upload')
    throw new ApiError(409, 'Source does not accept uploads');
  return source;
}
export async function createUpload(
  db: Database,
  scope: CrawlScope,
  sourceId: string,
  input: z.output<typeof uploadCreateSchema>,
  actorId: string,
) {
  return await db.transaction().execute(async (trx) => {
    await lockAuthorizedWorkspace(trx, scope.workspaceId, actorId, 'manage_credentials');
    requireCrawlLogs();
    await lockCrawlState(trx, scope);
    await sourceForUpload(trx, scope, sourceId);
    const now = new Date();
    return trx
      .insertInto('crawl_log_uploads')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        source_id: sourceId,
        filename: input.filename.replaceAll(/[/\\]/gu, '_'),
        size_bytes: input.size_bytes,
        status: 'open',
        missing_fields: '[]',
        last_ack_seq: -1,
        scanned_lines: 0,
        first_line_at: null,
        last_line_at: null,
        scanned_dates: '[]',
        created_at: now,
        updated_at: now,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
export async function completeUpload(
  db: Database,
  scope: CrawlScope,
  sourceId: string,
  id: string,
  input: z.output<typeof uploadCompleteSchema>,
  actorId: string,
  now = new Date(),
) {
  const scanFirst = input.first_line_at ? new Date(input.first_line_at) : null,
    scanLast = input.last_line_at ? new Date(input.last_line_at) : null;
  if (
    (scanFirst === null) !== (scanLast === null) ||
    (scanFirst && scanLast && scanFirst > scanLast)
  )
    throw new ApiError(422, 'Invalid scan span');
  if (input.scanned_lines > 0 && (!scanFirst || !scanLast))
    throw new ApiError(422, 'Scan timestamps are required');
  // A long-retention file is admitted for the part of its span inside the window.
  const floor = new Date(now.getTime() - crawlLogs.max_backdate_days * 86400000),
    ceiling = new Date(now.getTime() + crawlLogs.max_clock_skew_hours * 3600000);
  const first = scanFirst && (scanFirst < floor ? floor : scanFirst),
    last = scanLast && (scanLast > ceiling ? ceiling : scanLast);
  if (first && last && first > last) throw new ApiError(422, 'Scan span outside admission window');
  if (new Set(input.scanned_dates).size !== input.scanned_dates.length)
    throw new ApiError(422, 'Duplicate scanned day');
  return await db.transaction().execute(async (trx) => {
    await lockAuthorizedWorkspace(trx, scope.workspaceId, actorId, 'manage_credentials');
    requireCrawlLogs();
    const state = await lockCrawlState(trx, scope);
    const source = await sourceForUpload(trx, scope, sourceId);
    const upload = await trx
      .selectFrom('crawl_log_uploads')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('source_id', '=', sourceId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!upload) throw notFound('Upload');
    if (upload.status === 'completed') return upload;
    if (upload.status !== 'open') throw new ApiError(409, 'Upload is closed');
    if (input.scanned_dates.length && (!first || !last))
      throw new ApiError(422, 'Scanned days require timestamps');
    const dates = await scannedDays(trx, {
      scope,
      sourceId,
      host: source.host,
      tz: state.reporting_timezone,
      first,
      last,
    });
    const completed = await trx
      .updateTable('crawl_log_uploads')
      .set({
        status: 'completed',
        scanned_lines: input.scanned_lines,
        first_line_at: first,
        last_line_at: last,
        scanned_dates: JSON.stringify(dates),
        updated_at: now,
        completed_at: now,
      })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await enqueueRollup(trx, scope, now, { first, last });
    return completed;
  });
}
/** Declared days follow server reporting midnights; the client reports only its scan span. */
async function scannedDays(
  db: Database,
  input: {
    scope: CrawlScope;
    sourceId: string;
    host: string;
    tz: string;
    first: Date | null;
    last: Date | null;
  },
) {
  const { scope, sourceId, host, tz, first, last } = input;
  if (!first || !last) return [];
  const result = await sql<{ date: string; complete: boolean; overlapping: boolean }>`
    select to_char(day,'YYYY-MM-DD') as date,
      ${first}::timestamptz <= (day::timestamp at time zone ${tz})
      and ${last}::timestamptz >= ((day+interval '1 day')::timestamp at time zone ${tz}) - interval '1 second' as complete,
      (exists (
        select 1 from crawl_log_batches b join crawl_log_sources s on s.id=b.source_id
        where b.workspace_id=${scope.workspaceId}::uuid and b.project_id=${scope.projectId}::uuid
          and s.host=${host} and b.source_id<>${sourceId}::uuid and b.status='accepted'
          and (b.lines_matched>0 or b.lines_duplicate>0 or b.lines_unmatched>0 or b.heartbeat)
          and day::date between (coalesce(b.first_line_at,b.received_at) at time zone ${tz})::date
            and (coalesce(b.last_line_at,b.received_at) at time zone ${tz})::date
      ) or exists (
        select 1 from crawl_log_uploads u join crawl_log_sources s on s.id=u.source_id
        where u.workspace_id=${scope.workspaceId}::uuid and u.project_id=${scope.projectId}::uuid
          and s.host=${host} and u.source_id<>${sourceId}::uuid and u.status='completed'
          and exists(select 1 from jsonb_array_elements(u.scanned_dates) d where d->>'date'=to_char(day,'YYYY-MM-DD'))
      )) as overlapping
    from generate_series((${first}::timestamptz at time zone ${tz})::date,
      (${last}::timestamptz at time zone ${tz})::date, interval '1 day') day`.execute(db);
  // Another source already owns an overlapping day; this upload declares only the rest.
  return result.rows
    .filter((row) => !row.overlapping)
    .map(({ date, complete }) => ({ date, complete }));
}
