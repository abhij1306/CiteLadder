import { sql } from 'kysely';
import { z } from 'zod';
import {
  botActivityResponseSchema,
  botCrawlersResponseSchema,
  crawlCoverageResponseSchema,
  crawlSummarySchema,
  verificationSchema,
} from '@citeladder/contracts/ai-traffic';
import type { Database } from '../db/database.ts';
import { crawlers } from '../config/crawlers.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import {
  encodeKeysetCursor,
  decodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { isoDateText, utcTextOf, wireUtc } from '../db/timestamps.ts';
import { sourceList } from './source-reads.ts';
import { reportingDay, type CrawlScope } from './state.ts';
import { addDays } from '../referrals/projection.ts';

export type CrawlReadOptions = {
  range?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  purpose?: string | null;
  verification?: string | null;
  cursor?: string | null;
  limit?: number | null;
  bot_id?: string | null;
  status?: number | null;
  folder?: string | null;
  resource_class?: string | null;
  /** Resolved once per read from the project's crawl state; never caller input. */
  reporting_timezone?: string;
};
export function verificationFilter(value?: string | null) {
  if (!value) return crawlLogs.default_verification_filter;
  const items = value.split(',').sort((a, b) => a.localeCompare(b));
  if (!items.length || items.some((v) => !verificationSchema.safeParse(v).success))
    throw new ApiError(422, 'Invalid verification filter');
  return [...new Set(items)];
}
/** Every crawl read dates its window in the project's reporting timezone. */
export async function withReportingTimezone<T extends CrawlReadOptions>(
  db: Database,
  scope: CrawlScope,
  options: T,
): Promise<T & { reporting_timezone: string }> {
  if (options.reporting_timezone)
    return { ...options, reporting_timezone: options.reporting_timezone };
  const state = await db
    .selectFrom('crawl_log_states')
    .select('reporting_timezone')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  return {
    ...options,
    reporting_timezone: state?.reporting_timezone ?? crawlLogs.default_reporting_timezone,
  };
}
/** The reporting day in progress; it never makes a window incomplete. */
export function currentReportingDay(options: CrawlReadOptions, now = new Date()) {
  return reportingDay(now, options.reporting_timezone ?? crawlLogs.default_reporting_timezone);
}
export function presetDays(options: CrawlReadOptions) {
  const ranges: Record<string, number> = policy.analytics.preset_range_days;
  const days = ranges[options.range ?? crawlLogs.default_range];
  if (!days) throw new ApiError(422, 'Invalid crawl range');
  return days;
}
/** A window's first and last instants: local midnights in the reporting timezone. */
export function windowBounds(w: { start: string; end: string }, options: CrawlReadOptions) {
  const tz = options.reporting_timezone ?? crawlLogs.default_reporting_timezone;
  return {
    from: sql<Date>`${w.start}::date::timestamp at time zone ${tz}`,
    to: sql<Date>`(${w.end}::date + 1)::timestamp at time zone ${tz}`,
  };
}
/** The reporting window every crawl read and the overview route share. */
export function crawlWindow(options: CrawlReadOptions, now = new Date()) {
  if (Boolean(options.start_date) !== Boolean(options.end_date))
    throw new ApiError(422, 'Both dates are required');
  if (options.start_date && options.end_date) {
    if (
      !z.iso.date().safeParse(options.start_date).success ||
      !z.iso.date().safeParse(options.end_date).success ||
      options.start_date > options.end_date ||
      (Date.parse(options.end_date) - Date.parse(options.start_date)) / 86400000 + 1 >
        policy.analytics.max_window_days
    )
      throw new ApiError(422, 'Invalid crawl window');
    return { start: options.start_date, end: options.end_date };
  }
  const days = presetDays(options);
  const end = currentReportingDay(options, now);
  return { start: addDays(end, 1 - days), end };
}
function purposeBots(purpose?: string | null) {
  if (!purpose) return null;
  const bots = crawlers.bots.filter((b) => b.purpose === purpose).map((b) => b.bot_id);
  if (!bots.length) throw new ApiError(422, 'Invalid purpose');
  return bots;
}
function rollups(db: Database, scope: CrawlScope, options: CrawlReadOptions) {
  const w = crawlWindow(options),
    bots = purposeBots(options.purpose);
  let q = db
    .selectFrom('bot_activity_daily')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('reporting_date', '>=', sql<Date>`${w.start}::date`)
    .where('reporting_date', '<=', sql<Date>`${w.end}::date`)
    .where('verification', 'in', verificationFilter(options.verification));
  if (bots) q = q.where('bot_id', 'in', bots);
  if (options.bot_id) q = q.where('bot_id', '=', options.bot_id);
  if (options.folder) q = q.where('folder', '=', options.folder);
  if (options.resource_class) q = q.where('resource_class', '=', options.resource_class);
  if (options.status) q = q.where('status_code', '=', options.status);
  return q;
}
function cursorParts(scope: CrawlScope, view: string, options: CrawlReadOptions) {
  const endpoint = [scope.workspaceId, scope.projectId, view].join(':');
  const { cursor, ...filters } = options;
  try {
    return { endpoint, filters, keys: cursor ? decodeKeysetCursor(cursor, endpoint, filters) : [] };
  } catch (error) {
    if (error instanceof InvalidCursorError) throw new ApiError(422, error.message);
    throw error;
  }
}
export function pageLimit(options: CrawlReadOptions) {
  const limit = options.limit ?? crawlLogs.default_page_size;
  if (!Number.isInteger(limit) || limit < 1 || limit > crawlLogs.max_page_size)
    throw new ApiError(422, 'Invalid page size');
  return limit;
}
export async function crawlerPage(db: Database, scope: CrawlScope, input: CrawlReadOptions = {}) {
  const options = await withReportingTimezone(db, scope, input);
  const binding = cursorParts(scope, 'crawlers', options),
    limit = pageLimit(options);
  if (binding.keys.length && binding.keys.length !== 1)
    throw new ApiError(422, 'Invalid crawler cursor');
  let query = rollups(db, scope, options);
  if (binding.keys[0]) query = query.where('bot_id', '>', binding.keys[0]);
  const rows = await query
    .select([
      'bot_id',
      sql<number>`sum(requests)::integer`.as('requests'),
      sql<number>`count(distinct url_hash)::integer`.as('pages'),
      sql<Date>`max(last_seen_at)`.as('last_seen'),
    ])
    .groupBy('bot_id')
    .orderBy('bot_id')
    .limit(limit + 1)
    .execute();
  const selected = rows.slice(0, limit);
  const breakdowns = selected.length
    ? await crawlerBreakdowns(
        db,
        scope,
        options,
        selected.map((row) => row.bot_id),
      )
    : null;
  const items = selected.map((row) => {
    const bot = crawlers.bots.find((b) => b.bot_id === row.bot_id);
    const of = (key: keyof NonNullable<typeof breakdowns>) =>
      breakdowns?.[key].get(row.bot_id) ?? {};
    return {
      ...row,
      pages: row.pages || null,
      label: bot?.label ?? row.bot_id,
      purpose: bot?.purpose ?? 'unknown',
      last_seen: row.last_seen.toISOString(),
      status_codes: of('statuses'),
      verification: of('verifications'),
      verification_reasons: of('reasons'),
      folders: of('folders'),
      resources: of('resources'),
    };
  });
  const last = selected.at(-1);
  return botCrawlersResponseSchema.parse({
    items,
    next_cursor:
      rows.length > limit && last
        ? encodeKeysetCursor(binding.endpoint, binding.filters, [last.bot_id])
        : null,
  });
}
/** One grouped query per breakdown for a whole crawler page, bucketed by bot. */
async function crawlerBreakdowns(
  db: Database,
  scope: CrawlScope,
  options: CrawlReadOptions,
  botIds: string[],
) {
  const base = () => rollups(db, scope, options).where('bot_id', 'in', botIds);
  const count = sql<number>`sum(requests)::integer`.as('count');
  const [statuses, verifications, folders, resources, reasons] = await Promise.all([
    base().select(['bot_id', 'status_code', count]).groupBy(['bot_id', 'status_code']).execute(),
    base().select(['bot_id', 'verification', count]).groupBy(['bot_id', 'verification']).execute(),
    base()
      .select(['bot_id', 'folder', count])
      .groupBy(['bot_id', 'folder'])
      .orderBy('count', 'desc')
      .execute(),
    base()
      .select(['bot_id', 'resource_class', count])
      .groupBy(['bot_id', 'resource_class'])
      .execute(),
    base()
      .crossJoin(sql`jsonb_each(verification_reasons)`.as('r'))
      .select([
        'bot_id',
        sql<string>`r.key`.as('reason'),
        sql<number>`sum((r.value)::numeric)::integer`.as('count'),
      ])
      .where(sql<boolean>`jsonb_typeof(r.value) = 'number'`)
      .groupBy(['bot_id', sql`r.key`])
      .execute(),
  ]);
  const bucket = <T extends { bot_id: string; count: number }>(
    list: T[],
    key: (row: T) => string,
    cap = Infinity,
  ) => {
    const out = new Map<string, Record<string, number>>();
    for (const row of list) {
      const counts = out.get(row.bot_id) ?? {};
      if (Object.keys(counts).length < cap) counts[key(row)] = row.count;
      out.set(row.bot_id, counts);
    }
    return out;
  };
  return {
    statuses: bucket(statuses, (s) => String(s.status_code)),
    verifications: bucket(verifications, (s) => s.verification),
    folders: bucket(folders, (s) => s.folder, crawlLogs.max_page_size),
    resources: bucket(resources, (s) => s.resource_class),
    reasons: bucket(reasons, (s) => s.reason),
  };
}
export async function activityPage(db: Database, scope: CrawlScope, input: CrawlReadOptions = {}) {
  const options = await withReportingTimezone(db, scope, input);
  const binding = cursorParts(scope, 'activity', options),
    limit = pageLimit(options);
  let query = db
    .selectFrom('bot_requests')
    .select([
      'id',
      'source_id',
      'batch_id',
      'host',
      'display_path',
      'identity',
      'identity_reason',
      'url_hash',
      'folder',
      'resource_class',
      'method',
      'status_code',
      'bot_id',
      'catalog_version',
      'verification',
      'verification_reason',
      'verification_basis',
      'ip_range_snapshot_id',
      utcTextOf(sql.ref('occurred_at')).as('occurred'),
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('occurred_at', '>=', new Date(Date.now() - crawlLogs.retention_days * 86400000))
    .where('verification', 'in', verificationFilter(options.verification));
  const bots = purposeBots(options.purpose);
  if (bots) query = query.where('bot_id', 'in', bots);
  if (options.bot_id) query = query.where('bot_id', '=', options.bot_id);
  if (options.status) query = query.where('status_code', '=', options.status);
  if (options.folder) query = query.where('folder', '=', options.folder);
  if (options.resource_class) query = query.where('resource_class', '=', options.resource_class);
  if (options.range || options.start_date || options.end_date) {
    const { from, to } = windowBounds(crawlWindow(options), options);
    query = query.where('occurred_at', '>=', from).where('occurred_at', '<', to);
  }
  if (binding.keys.length) {
    if (
      binding.keys.length !== 2 ||
      !z.iso.datetime({ offset: true }).safeParse(binding.keys[0]).success ||
      !z.uuid().safeParse(binding.keys[1]).success
    )
      throw new ApiError(422, 'Invalid activity cursor');
    query = query.where(
      sql<boolean>`(occurred_at,id)<(${binding.keys[0]}::timestamptz,${binding.keys[1]}::uuid)`,
    );
  }
  const rows = await query
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .execute();
  const items = rows
    .slice(0, limit)
    .map(({ occurred, ...row }) => ({ ...row, occurred_at: wireUtc(occurred) }));
  const last = items.at(-1);
  return botActivityResponseSchema.parse({
    items,
    next_cursor:
      rows.length > limit && last
        ? encodeKeysetCursor(binding.endpoint, binding.filters, [last.occurred_at, last.id])
        : null,
  });
}
export async function coveragePage(db: Database, scope: CrawlScope, input: CrawlReadOptions = {}) {
  const options = await withReportingTimezone(db, scope, input);
  const w = crawlWindow(options),
    limit = pageLimit(options),
    binding = cursorParts(scope, 'coverage', options);
  let q = db
    .selectFrom('crawl_log_coverage_daily')
    .select([
      'source_id',
      'reporting_timezone',
      'coverage',
      'reason',
      'batch_count',
      'heartbeat_count',
      'max_gap_minutes',
      isoDateText(sql.ref('reporting_date')).as('reporting_date'),
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('reporting_date', '>=', sql<Date>`${w.start}::date`)
    .where('reporting_date', '<=', sql<Date>`${w.end}::date`);
  if (binding.keys.length) {
    if (
      binding.keys.length !== 3 ||
      !z.iso.date().safeParse(binding.keys[0]).success ||
      !z.uuid().safeParse(binding.keys[1]).success
    )
      throw new ApiError(422, 'Invalid coverage cursor');
    q = q.where(
      sql<boolean>`(reporting_date,source_id,reporting_timezone)>(${binding.keys[0]}::date,${binding.keys[1]}::uuid,${binding.keys[2]})`,
    );
  }
  const [rows, sources] = await Promise.all([
    q
      .orderBy('reporting_date')
      .orderBy('source_id')
      .orderBy('reporting_timezone')
      .limit(limit + 1)
      .execute(),
    sourceList(db, scope),
  ]);
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return crawlCoverageResponseSchema.parse({
    items,
    sources: sources.items,
    next_cursor:
      rows.length > limit && last
        ? encodeKeysetCursor(binding.endpoint, binding.filters, [
            last.reporting_date,
            last.source_id,
            last.reporting_timezone,
          ])
        : null,
  });
}
export async function crawlSummary(db: Database, scope: CrawlScope, input: CrawlReadOptions = {}) {
  const options = await withReportingTimezone(db, scope, input);
  const w = crawlWindow(options),
    filtered = rollups(db, scope, options);
  const [total, failed, coverage, series, { items: sources }] = await Promise.all([
    filtered
      .select([
        sql<number>`coalesce(sum(requests),0)::integer`.as('requests'),
        sql<number>`count(distinct url_hash)::integer`.as('pages'),
        sql<number>`count(distinct bot_id)::integer`.as('bots'),
        sql<number>`coalesce(sum(requests) filter(where status_code>=400),0)::integer`.as('errors'),
      ])
      .executeTakeFirstOrThrow(),
    rollups(db, scope, { ...options, verification: 'failed_verification' })
      .select(sql<number>`coalesce(sum(requests),0)::integer`.as('count'))
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('crawl_log_coverage_daily')
      .select([
        'coverage',
        'reporting_timezone',
        isoDateText(sql.ref('reporting_date')).as('day'),
        sql<string>`(select host from crawl_log_sources s where s.id=source_id)`.as('host'),
      ])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('reporting_date', '>=', sql<Date>`${w.start}::date`)
      .where('reporting_date', '<=', sql<Date>`${w.end}::date`)
      .execute(),
    filtered
      .select([
        isoDateText(sql.ref('reporting_date')).as('date'),
        'bot_id',
        sql<number>`sum(requests)::integer`.as('requests'),
      ])
      .groupBy(['reporting_date', 'bot_id'])
      .orderBy('reporting_date')
      .execute(),
    sourceList(db, scope),
  ]);
  const quality = coverageQuality(coverage, w, currentReportingDay(options));
  const adequate = quality === 'complete' || quality === 'declared_complete';
  let connection = 'not_connected';
  if (sources.some((s) => s.status === 'active'))
    connection = sources.some((s) => s.connection === 'connected') ? 'connected' : 'awaiting_data';
  const measured = total.requests > 0 || adequate;
  return crawlSummarySchema.parse({
    unit: 'requests',
    identity_level: 'path',
    connection,
    coverage: quality,
    reporting_timezone:
      [...new Set(coverage.map((c) => c.reporting_timezone))].join(', ') ||
      crawlLogs.default_reporting_timezone,
    last_processed_at:
      sources
        .map((s) => s.last_processed_at)
        .filter((s): s is string => !!s)
        .sort((a, b) => a.localeCompare(b))
        .at(-1) ?? null,
    requests: measured ? total.requests : null,
    pages: total.pages > 0 || adequate ? total.pages : null,
    active_bots: measured ? total.bots : null,
    error_share:
      total.requests && (total.errors > 0 || adequate) ? total.errors / total.requests : null,
    failed_verification_requests: failed.count > 0 || adequate ? failed.count : null,
    series: purposeSeries(series),
  });
}

function purposeSeries(series: { date: string; bot_id: string; requests: number }[]) {
  const purposes = new Map<string, { date: string; purpose: string; requests: number }>();
  for (const row of series) {
    const purpose = crawlers.bots.find((bot) => bot.bot_id === row.bot_id)?.purpose ?? 'unknown';
    const key = row.date + ':' + purpose;
    const old = purposes.get(key);
    if (old) old.requests += row.requests;
    else purposes.set(key, { date: row.date, purpose, requests: row.requests });
  }
  return [...purposes.values()];
}

/** Judged over closed days: the day in progress counts requests but cannot be complete. */
function coverageQuality(
  all: { coverage: string; day: string; host: string }[],
  w: { start: string; end: string },
  today: string,
) {
  const end = w.end < today ? w.end : addDays(today, -1);
  const rows = all.filter((row) => row.day <= end);
  const expected = (Date.parse(end) - Date.parse(w.start)) / 86400000 + 1;
  const hosts = new Set(all.map((row) => row.host));
  // A window of only the day in progress has no closed day to be complete.
  const judged = expected >= 1 && hosts.size > 0;
  const keys = (row: (typeof rows)[number]) => row.day + ':' + row.host;
  const complete = new Set(rows.filter((row) => row.coverage === 'complete').map(keys));
  if (judged && complete.size === expected * hosts.size) return 'complete';
  const covered = new Set(
    rows
      .filter((row) => row.coverage === 'complete' || row.coverage === 'declared_complete')
      .map(keys),
  );
  if (judged && covered.size === expected * hosts.size) return 'declared_complete';
  return all.some((row) => row.coverage !== 'unknown') ? 'partial' : 'unknown';
}
