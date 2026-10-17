import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { Insertable, Selectable } from 'kysely';
import { sql } from 'kysely';
import { logLines, UnsupportedLogFormat } from '@citeladder/contracts/crawl-log-format';
import type { Database } from '../db/database.ts';
import type { BotRequests, CrawlLogBatches, CrawlLogSources } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { crawlers } from '../config/crawlers.ts';
import { strings } from '../db/json.ts';
import { enforceSubjectRequest } from '../abuse/usage.ts';
import { prepareBatch } from './prepare.ts';
import { lockCrawlState, enqueueRollup, reportingDay, type CrawlScope } from './state.ts';
import { requireCrawlLogs } from './sources.ts';
import { lockAuthorizedWorkspace } from '../workspaces/service.ts';
import { clearStall } from './stall.ts';
import { withReportingTimezone } from './reads.ts';

export async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > crawlLogs.max_batch_bytes) throw new ApiError(413, 'Log batch too large');
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function decodedBody(body: Buffer, encoding: string | undefined) {
  if (body.length > crawlLogs.max_batch_bytes) throw new ApiError(413, 'Log batch too large');
  if (encoding && !['gzip', 'identity'].includes(encoding))
    throw new ApiError(415, 'Unsupported log encoding');
  try {
    const decoded =
      encoding === 'gzip' ? gunzipSync(body, { maxOutputLength: crawlLogs.max_batch_bytes }) : body;
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE')
      throw new ApiError(413, 'Decompressed log batch too large');
    throw new ApiError(422, 'Invalid compressed or UTF-8 log batch');
  }
}
/** The receipt this source already stored under an idempotency key, if any. */
function storedReceipt(db: Database, source: Selectable<CrawlLogSources>, key: string) {
  return db
    .selectFrom('crawl_log_batches')
    .selectAll()
    .where('workspace_id', '=', source.workspace_id)
    .where('source_id', '=', source.id)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
}
/** A receipt as its sender is answered: an unsupported format is refused with its missing fields. */
export function answeredReceipt(receipt: Selectable<CrawlLogBatches>) {
  if (receipt.status === 'unsupported_format')
    throw new ApiError(
      422,
      'This log format does not contain the fields needed for crawler identification.',
      {
        details: { status: receipt.status, missing_fields: strings(receipt.missing_fields) },
      },
    );
  return receipt;
}
/**
 * Spend one batch attempt, or return the receipt already stored under `key`.
 * A retried key spends no quota, so its caller answers from that receipt
 * without reading or decoding the body again.
 */
export async function batchQuota(
  db: Database,
  source: Selectable<CrawlLogSources>,
  now = new Date(),
  key?: string | null,
): Promise<Selectable<CrawlLogBatches> | undefined> {
  const stored = key ? await storedReceipt(db, source, key) : undefined;
  if (stored) return stored;
  await receivedBytesCeiling(db, source, now);
  await enforceSubjectRequest(
    db,
    'crawl_source',
    source.id,
    {
      operation: 'crawl_logs.batch',
      limit: crawlLogs.batches_per_source_per_hour,
      windowSeconds: 3600,
    },
    now,
  );
}
/**
 * Refuse a project whose receipts already hold `received_bytes_per_project_per_day`
 * decompressed bytes on its current reporting day, until the next day starts.
 * One diagnostic receipt per source and day records the refusal.
 */
async function receivedBytesCeiling(db: Database, source: Selectable<CrawlLogSources>, now: Date) {
  const { reporting_timezone: tz } = await withReportingTimezone(
    db,
    { workspaceId: source.workspace_id, projectId: source.project_id },
    {},
  );
  const today = reportingDay(now, tz);
  const day = sql<Date>`(${today}::date::timestamp at time zone ${tz})`;
  const usage = await db
    .selectFrom('crawl_log_batches')
    .select([
      sql<string>`coalesce(sum(bytes_received), 0)`.as('used'),
      sql<number>`ceil(extract(epoch from (${day} + interval '1 day' - ${now}::timestamptz)))::integer`.as(
        'retry_after',
      ),
    ])
    .where('workspace_id', '=', source.workspace_id)
    .where('project_id', '=', source.project_id)
    .where('received_at', '>=', day)
    .executeTakeFirstOrThrow();
  if (Number(usage.used) < crawlLogs.received_bytes_per_project_per_day) return;
  await diagnosticReceipt(db, source, 'bytes_ceiling', now, tz);
  throw new ApiError(429, 'Daily received log volume reached for this project', {
    headers: { 'Retry-After': String(Math.max(1, usage.retry_after)) },
  });
}
/**
 * A refusal the sender only sees as a status code, kept as a zero-line receipt.
 * Keyed per source, kind and the project's reporting day, so retries add no rows.
 */
export async function diagnosticReceipt(
  db: Database,
  source: Selectable<CrawlLogSources>,
  status: 'bytes_ceiling' | 'oversize',
  now: Date,
  timezone?: string,
) {
  const tz =
    timezone ??
    (
      await withReportingTimezone(
        db,
        { workspaceId: source.workspace_id, projectId: source.project_id },
        {},
      )
    ).reporting_timezone;
  const day = reportingDay(now, tz);
  await db
    .insertInto('crawl_log_batches')
    .values({
      id: randomUUID(),
      workspace_id: source.workspace_id,
      project_id: source.project_id,
      source_id: source.id,
      upload_id: null,
      seq: null,
      idempotency_key: `diagnostic:${status}:${day}`,
      received_at: now,
      format: source.format,
      status,
      missing_fields: JSON.stringify([]),
      parser_version: crawlLogs.parser_version,
      catalog_version: crawlers.catalog_version,
      lines_received: 0,
      lines_parsed: 0,
      lines_matched: 0,
      lines_unmatched: 0,
      lines_out_of_scope: 0,
      lines_rejected: 0,
      lines_duplicate: 0,
      lines_overlapping: 0,
      first_line_at: null,
      last_line_at: null,
      heartbeat: false,
      bytes_received: 0,
      drained: false,
    })
    .onConflict((c) => c.constraint('uq_crawl_log_batch_key').doNothing())
    .execute();
}
/** One admission owner for webhooks and uploads. No provider or model I/O. */
export async function ingest(
  db: Database,
  source: Selectable<CrawlLogSources>,
  body: Buffer,
  options: {
    key?: string;
    encoding?: string;
    now?: Date;
    uploadId?: string;
    seq?: number;
    tokenHash?: string;
    actorId?: string;
    quotaChecked?: boolean;
    /** The caller already refused an unavailable workspace (`authorizeToken`). */
    accessChecked?: boolean;
    /** Records an adaptor could not decode into lines; counted as rejected lines. */
    rejectedRecords?: number;
    /** Decompressed bytes the sender delivered, when more than this batch's lines. */
    receivedBytes?: number;
    /** A pull found its subscription empty; only a heartbeat can be a drain. */
    drained?: boolean;
  },
) {
  if (!options.accessChecked) requireCrawlLogs();
  const now = options.now ?? new Date();
  const key = options.key ?? createHash('sha256').update(body).digest('hex');
  if (!key.trim() || key.length > 255) throw new ApiError(422, 'Invalid idempotency key');
  // Attempt quota commits before parsing; replay does not spend accepted-line quota.
  if (!options.quotaChecked) await batchQuota(db, source, now, options.key);
  const {
    lines,
    validation,
    format,
    bytes,
    unsupported: formatError,
  } = decodeBatch(source, body, options.encoding, Boolean(options.uploadId));
  let unsupported = formatError;
  // Only batches with lines to verify need the IP range snapshots.
  const snapshots =
    lines.length && !validation && !unsupported
      ? await db
          .selectFrom('bot_ip_range_snapshots')
          .selectAll()
          .where('status', '=', 'succeeded')
          .distinctOn('bot_id')
          .orderBy('bot_id')
          .orderBy('fetched_at', 'desc')
          .orderBy('id', 'desc')
          .execute()
      : [];
  const latest = new Map(snapshots.map((s) => [s.bot_id, s] as const));
  if (!options.uploadId && !validation && !unsupported && lines.length === 0 && !options.key)
    throw new ApiError(422, 'Heartbeat batches require an explicit unique idempotency key');
  const scope = { workspaceId: source.workspace_id, projectId: source.project_id };
  const preset = crawlLogs.presets[options.uploadId ? 'custom_ndjson' : source.preset];
  if (!preset) throw new ApiError(415, 'Unsupported preset');
  const preparedBatch = prepareBatch({ source, lines, preset, latest, now, format });
  const { counts, prepared, first, last } = preparedBatch;
  const rejectedRecords = options.rejectedRecords ?? 0;
  counts.lines_received += rejectedRecords;
  counts.lines_rejected += rejectedRecords;
  unsupported ??= preparedBatch.unsupported;
  let receiptStatus = 'accepted';
  if (validation) receiptStatus = 'destination_validation';
  if (unsupported) receiptStatus = 'unsupported_format';
  const receipt = await db.transaction().execute(async (trx) => {
    if (options.actorId)
      await lockAuthorizedWorkspace(trx, scope.workspaceId, options.actorId, 'manage_credentials');
    requireCrawlLogs();
    const state = await lockCrawlState(trx, scope);
    const current = await trx
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', source.id)
      .forUpdate()
      .executeTakeFirst();
    if (!current) throw notFound('Crawl log source');
    if (current.status !== 'active') throw new ApiError(409, 'Crawl log source revoked');
    if (options.tokenHash && current.token_hash !== options.tokenHash)
      throw new ApiError(401, 'Invalid crawl log token');
    const original = await storedReceipt(trx, source, key);
    if (original) return original;
    await assertUpload(trx, scope, source.id, options.uploadId, options.seq);
    const admitted = await admitRequests(
      trx,
      scope,
      current,
      prepared,
      state.reporting_timezone,
      counts,
    );
    const id = randomUUID();
    const heartbeat =
      !options.uploadId &&
      !unsupported &&
      !validation &&
      lines.length === 0 &&
      rejectedRecords === 0;
    await trx
      .insertInto('crawl_log_batches')
      .values({
        id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        source_id: source.id,
        upload_id: options.uploadId ?? null,
        seq: options.seq ?? null,
        idempotency_key: key,
        received_at: now,
        format,
        status: receiptStatus,
        missing_fields: JSON.stringify(unsupported?.missing_fields ?? []),
        parser_version: crawlLogs.parser_version,
        catalog_version: crawlers.catalog_version,
        ...counts,
        first_line_at: first,
        last_line_at: last,
        heartbeat,
        bytes_received: options.receivedBytes ?? bytes,
        drained: heartbeat && options.drained === true,
      })
      .execute();
    if (receiptStatus === 'accepted' && current.stall_reason !== null)
      await clearStall(trx, current);
    await insertRequests(trx, scope, id, admitted, counts, now);
    const receipt = await trx
      .updateTable('crawl_log_batches')
      .set(counts)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (options.uploadId)
      await trx
        .updateTable('crawl_log_uploads')
        .set({
          last_ack_seq: options.seq!,
          updated_at: now,
          ...(unsupported
            ? {
                status: 'unsupported_format',
                missing_fields: JSON.stringify(unsupported.missing_fields),
              }
            : {}),
        })
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', '=', options.uploadId)
        .execute();
    await enqueueRollup(trx, scope, now, { first, last });
    return receipt;
  });
  return answeredReceipt(receipt);
}
async function admitRequests(
  trx: Database,
  scope: CrawlScope,
  source: Selectable<CrawlLogSources>,
  prepared: Insertable<BotRequests>[],
  tz: string,
  counts: ReturnType<typeof prepareBatch>['counts'],
) {
  const days = [...new Set(prepared.map((row) => reportingDay(row.occurred_at as Date, tz)))];
  if (!days.length) return [];
  const excluded = await sql<{ day: string }>`with days as (select unnest(${days}::date[]) as day)
    select to_char(day,'YYYY-MM-DD') as day from days where exists (
      select 1 from crawl_log_batches b join crawl_log_sources s on s.id=b.source_id
      where b.workspace_id=${scope.workspaceId}::uuid and b.project_id=${scope.projectId}::uuid
      and s.host=${source.host} and b.source_id<>${source.id}::uuid and b.status='accepted'
      and (b.lines_matched>0 or b.lines_duplicate>0 or b.lines_unmatched>0 or b.heartbeat)
      and ((day between (b.first_line_at at time zone ${tz})::date and (b.last_line_at at time zone ${tz})::date)
        or (b.heartbeat and (b.received_at at time zone ${tz})::date=day))
    ) or exists (
      select 1 from crawl_log_uploads u join crawl_log_sources s on s.id=u.source_id
      where u.workspace_id=${scope.workspaceId}::uuid and u.project_id=${scope.projectId}::uuid
      and s.host=${source.host} and u.source_id<>${source.id}::uuid and u.status='completed'
      and exists(select 1 from jsonb_array_elements(u.scanned_dates) d where d->>'date'=to_char(day,'YYYY-MM-DD'))
    )`.execute(trx);
  const overlapping = new Set(excluded.rows.map((row) => row.day));
  const admitted = prepared.filter(
    (row) => !overlapping.has(reportingDay(row.occurred_at as Date, tz)),
  );
  counts.lines_overlapping += prepared.length - admitted.length;
  return admitted;
}
async function insertRequests(
  trx: Database,
  scope: CrawlScope,
  id: string,
  admitted: Insertable<BotRequests>[],
  counts: ReturnType<typeof prepareBatch>['counts'],
  now: Date,
) {
  if (admitted.length) {
    for (let start = 0; start < admitted.length; start += crawlLogs.insert_rows_per_statement) {
      const inserted = await trx
        .insertInto('bot_requests')
        .values(
          admitted
            .slice(start, start + crawlLogs.insert_rows_per_statement)
            .map((row) => ({ ...row, batch_id: id })),
        )
        .onConflict((c) => c.doNothing())
        .returning('id')
        .execute();
      counts.lines_matched += inserted.length;
    }
    counts.lines_duplicate = admitted.length - counts.lines_matched;
    if (counts.lines_matched)
      await enforceSubjectRequest(
        trx,
        'crawl_project',
        scope.projectId,
        {
          operation: 'crawl_logs.accepted_lines',
          limit: crawlLogs.accepted_lines_per_project_per_day,
          windowSeconds: 86400,
          amount: counts.lines_matched,
        },
        now,
      );
  }
}
function decodeBatch(
  source: Selectable<CrawlLogSources>,
  body: Buffer,
  explicitEncoding: string | undefined,
  upload: boolean,
) {
  const encoding =
    explicitEncoding ??
    (source.setup === 'cloudflare_logpush' && body[0] === 0x1f && body[1] === 0x8b
      ? 'gzip'
      : undefined);
  const text = decodedBody(body, encoding);
  const format = upload ? 'ndjson' : source.format;
  let lines: string[] = [];
  let unsupported: UnsupportedLogFormat | null = null;
  // Cloudflare validates HTTP destinations with this authenticated gzipped probe.
  const validation =
    source.setup === 'cloudflare_logpush' &&
    /^\s*\{\s*"content"\s*:\s*"tests"\s*\}\s*$/u.test(text);
  try {
    lines = validation ? [] : logLines(text, format, crawlLogs.max_lines_per_batch);
  } catch (error) {
    if (error instanceof RangeError) throw new ApiError(413, 'Too many log lines');
    if (error instanceof UnsupportedLogFormat) unsupported = error;
    else throw error;
  }

  return { lines, validation, unsupported, format, bytes: Buffer.byteLength(text) };
}
async function assertUpload(
  trx: Database,
  scope: CrawlScope,
  sourceId: string,
  uploadId: string | undefined,
  seq: number | undefined,
) {
  if (uploadId) {
    const upload = await trx
      .selectFrom('crawl_log_uploads')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('source_id', '=', sourceId)
      .where('id', '=', uploadId)
      .forUpdate()
      .executeTakeFirst();
    if (!upload) throw notFound('Upload');
    if (upload.status !== 'open' || seq !== upload.last_ack_seq + 1)
      throw new ApiError(409, 'Upload is closed or batch sequence is out of order');
  }
}
