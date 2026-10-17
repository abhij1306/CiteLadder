/** Persisted Performance reads shared by the API and Agent. */
import {
  performanceDimensionSchema,
  performanceDashboardSchema,
} from '@citeladder/contracts/performance';
import { type RawBuilder, sql } from 'kysely';
import type { z } from 'zod';

import { metricSeriesPoints } from '../analytics/metric-series.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { parseUuid } from '../http/uuid.ts';
import { addDays } from '../referrals/projection.ts';
import { numberOrNull } from './accumulators.ts';
import { hash } from './normalization.ts';
import { record } from '../db/json.ts';
import { compareText } from '../text-order.ts';

const p = policy.traffic;
const integer = (value: unknown) => {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
};
export const windowDays = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
export type Window = readonly [string, string];
type Scope = { workspaceId: string; projectId: string };
function customWindow(start?: string | null, end?: string | null): Window | null {
  if (start == null && end == null) return null;
  if (!start || !end) throw new ApiError(422, "'from' and 'to' must be supplied together");
  if (end < start) throw new ApiError(422, "'to' must not be before 'from'");
  if (windowDays(start, end) > p.PERFORMANCE_CUSTOM_RANGE_MAX_DAYS)
    throw new ApiError(422, `window exceeds ${p.PERFORMANCE_CUSTOM_RANGE_MAX_DAYS} days`);
  return [start, end];
}
/**
 * A custom window ending no later than the latest imported date, so a future
 * `to` names the same persisted window as the data it can contain. A window
 * that starts after that date is returned unchanged (and has no evidence);
 * `latest` is null without any imported evidence.
 */
export async function clampedCustomWindow(
  db: Database,
  scope: Scope,
  start?: string | null,
  end?: string | null,
): Promise<{ window: Window | null; latest: string | null }> {
  const window = customWindow(start, end);
  if (!window) return { window, latest: null };
  const row = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'integration_metric_rows')
    .select(isoDateText(sql`max(date)`).as('end'))
    .where('project_id', '=', scope.projectId)
    .where('dataset', 'in', p.TRAFFIC_CONSUMED_DATASETS)
    .executeTakeFirst();
  const latest = row?.end ?? null;
  if (latest === null || window[1] <= latest || window[0] > latest) return { window, latest };
  return { window: [window[0], latest], latest };
}
function choice(
  label: string,
  value: string | null | undefined,
  fallback: string,
  choices: readonly string[],
): string {
  const selected = value || fallback;
  if (!choices.includes(selected))
    throw new ApiError(422, `unknown performance ${label}: '${selected}'`);
  return selected;
}
function snapshots(db: Database, scope: Scope) {
  return new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'traffic_snapshots')
    .selectAll()
    .select([
      isoDateText(sql.ref('window_start')).as('start'),
      isoDateText(sql.ref('window_end')).as('end'),
    ])
    .where('project_id', '=', scope.projectId);
}
type Snapshot = NonNullable<Awaited<ReturnType<ReturnType<typeof snapshots>['executeTakeFirst']>>>;
function exactSnapshot(db: Database, scope: Scope, window: Window, granularity: string) {
  return snapshots(db, scope)
    .where('window_start', '=', sql<Date>`${window[0]}::date`)
    .where('window_end', '=', sql<Date>`${window[1]}::date`)
    .where('granularity', '=', granularity)
    .executeTakeFirst();
}
async function selectedDates(
  db: Database,
  scope: Scope,
  range: string,
  explicit: Window | null,
): Promise<Window | null> {
  if (explicit) return explicit;
  const presets: Record<string, number> = p.PERFORMANCE_PRESET_RANGE_DAYS;
  const extended: Record<string, number> = p.PERFORMANCE_EXTENDED_RANGE_DAYS;
  const query = snapshots(db, scope)
    .where('granularity', '=', p.TRAFFIC_DEFAULT_GRANULARITY)
    .orderBy('window_end', 'desc');
  if (range in presets) {
    const row = await query
      .where('preset_window_days', '=', presets[range]!)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return row ? [row.start, row.end] : null;
  }
  if (range === p.PERFORMANCE_RANGE_LAST_SYNCED) {
    const row = await new WorkspaceScope(scope.workspaceId)
      .selectFrom(db, 'integration_metric_rows')
      .select([isoDateText(sql`min(date)`).as('start'), isoDateText(sql`max(date)`).as('end')])
      .where('project_id', '=', scope.projectId)
      .where('dataset', 'in', p.TRAFFIC_CONSUMED_DATASETS)
      .executeTakeFirst();
    if (!row?.start || !row.end) return null;
    const floor = addDays(row.end, -(p.TRAFFIC_MAX_WINDOW_DAYS - 1));
    // ISO dates order as text; the later of the first import and the window floor.
    return [compareText(row.start, floor) > 0 ? row.start : floor, row.end];
  }
  if (range in extended) {
    // The preset family ends at the refresh's partition anchor; a display-only
    // custom snapshot (possibly ending later) must not move this range.
    const anchor = await query
      .where('preset_window_days', 'is not', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return anchor ? [addDays(anchor.end, -(extended[range]! - 1)), anchor.end] : null;
  }
  const row = await query.orderBy('window_start', 'asc').orderBy('id', 'desc').executeTakeFirst();
  return row ? [row.start, row.end] : null;
}

function performanceWindow(
  snapshot: Pick<Snapshot, 'id' | 'start' | 'end' | 'metrics'> | undefined,
  window: Window | null,
) {
  const raw = record(snapshot?.metrics);
  const m = record(raw.totals);
  const totals = {
    clicks: integer(m.clicks),
    impressions: integer(m.impressions),
    ctr: numberOrNull(m.ctr),
    position: numberOrNull(m.position),
    sessions: integer(m.sessions),
    key_events: numberOrNull(m.key_events),
  };
  const observed = [totals.clicks, totals.impressions, totals.sessions, totals.key_events];
  const series = record(raw.series);
  let evidenceState: 'not_run' | 'available' | 'observed_zero' = 'observed_zero';
  if (observed.every((v) => v === null)) evidenceState = 'not_run';
  else if (observed.some(Boolean)) evidenceState = 'available';
  return {
    snapshot_id: snapshot?.id ?? null,
    window_start: snapshot?.start ?? window?.[0] ?? '',
    window_end: snapshot?.end ?? window?.[1] ?? '',
    evidence_state: evidenceState,
    totals,
    series: {
      clicks: metricSeriesPoints(series.clicks),
      impressions: metricSeriesPoints(series.impressions),
      ctr: metricSeriesPoints(series.ctr),
      position: metricSeriesPoints(series.position),
    },
  };
}

export async function getPerformance(
  db: Database,
  options: Scope & {
    range?: string | null;
    from?: string | null;
    to?: string | null;
    compare?: string | null;
    compare_from?: string | null;
    compare_to?: string | null;
    granularity?: string | null;
  },
) {
  const range = choice('range', options.range, p.PERFORMANCE_DEFAULT_RANGE, p.PERFORMANCE_RANGES);
  const granularity = options.granularity ?? p.TRAFFIC_DEFAULT_GRANULARITY;
  if (!p.TRAFFIC_SNAPSHOT_GRANULARITIES.includes(granularity))
    throw new ApiError(422, `unknown performance granularity: '${granularity}'`);
  const compare = choice(
    'compare',
    options.compare,
    p.PERFORMANCE_DEFAULT_COMPARE,
    p.PERFORMANCE_COMPARE_MODES,
  );
  const custom = await clampedCustomWindow(db, options, options.from, options.to);
  const window = await selectedDates(db, options, range, custom.window);
  const snapshot = window ? await exactSnapshot(db, options, window, granularity) : undefined;
  let comparison = null;
  if (window && compare !== p.PERFORMANCE_COMPARE_NONE) {
    let peer: Window | null;
    if (compare === p.PERFORMANCE_COMPARE_PREVIOUS)
      peer = [addDays(window[0], -windowDays(...window)), addDays(window[0], -1)];
    else if (compare === p.PERFORMANCE_COMPARE_YEAR_OVER_YEAR)
      peer = window.map((day) =>
        addDays(day, -p.PERFORMANCE_YEAR_OVER_YEAR_SHIFT_DAYS),
      ) as unknown as Window;
    else peer = customWindow(options.compare_from, options.compare_to);
    if (!peer) throw new ApiError(422, "compare=custom requires 'compare_from' and 'compare_to'");
    comparison = performanceWindow(await exactSnapshot(db, options, peer, granularity), peer);
  }
  const coverage = record(snapshot?.coverage);
  const counts = record(snapshot?.dimension_counts);
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return {
    project_id: options.projectId,
    range,
    granularity,
    compare,
    selected: performanceWindow(snapshot, window),
    comparison,
    coverage: {
      earliest_date: text(coverage.earliest_date),
      latest_date: text(coverage.latest_date),
      covered_days: integer(coverage.covered_days) ?? 0,
      analytics_quality: performanceDashboardSchema.shape.coverage.shape.analytics_quality.parse(
        coverage.analytics_quality ?? {},
      ),
    },
    dimension_counts: Object.fromEntries(
      performanceDimensionSchema.options.map((d) => [d, integer(counts[d]) ?? 0]),
    ) as Record<z.infer<typeof performanceDimensionSchema>, number>,
    unavailable_dimensions: p.PERFORMANCE_UNAVAILABLE_DIMENSIONS,
    formula_version: snapshot?.formula_version ?? p.TRAFFIC_FORMULA_VERSION,
    normalization_version: snapshot?.normalization_version ?? p.TRAFFIC_NORMALIZATION_VERSION,
  };
}

function tableMetrics(value: unknown) {
  const m = record(value);
  return {
    clicks: integer(m.clicks),
    impressions: integer(m.impressions),
    ctr: numberOrNull(m.ctr),
    position: numberOrNull(m.position),
  };
}
function badCursor(): never {
  throw new ApiError(400, 'Invalid performance cursor', { code: 'invalid_cursor' });
}
type TableSort = { sort: string; key: string; descending: boolean };
type TableKeyset = readonly [string, string];

function tablePageSize(requested: number | null | undefined) {
  const pageSize = requested ?? p.PERFORMANCE_DEFAULT_PAGE_SIZE;
  if (!p.PERFORMANCE_PAGE_SIZE_OPTIONS.includes(pageSize))
    throw new ApiError(
      422,
      `page_size must be one of [${[...p.PERFORMANCE_PAGE_SIZE_OPTIONS].sort((a, b) => a - b).join(', ')}]`,
    );
  return pageSize;
}
function tableSort(dimension: string, requested: string | null | undefined): TableSort {
  const defaults: Record<string, string> = p.PERFORMANCE_DIMENSION_DEFAULT_SORT;
  const sort = requested || defaults[dimension]!;
  const descending = sort.startsWith('-');
  const key = descending ? sort.slice(1) : sort;
  if (!p.PERFORMANCE_SORT_WHITELIST.includes(key))
    throw new ApiError(422, `unknown performance sort: '${sort}'`);
  return { sort, key, descending };
}
function decodeTableCursor(cursor: string, fingerprint: string): TableKeyset {
  let decoded: Record<string, unknown>;
  try {
    decoded = record(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    badCursor();
  }
  const k = decoded.k;
  if (
    decoded.fp !== fingerprint ||
    !Array.isArray(k) ||
    k.length !== 2 ||
    typeof k[0] !== 'string' ||
    !parseUuid(k[1])
  )
    badCursor();
  return [k[0], k[1] as string];
}
function encodeTableCursor(fingerprint: string, value: string | number | null, id: string) {
  return Buffer.from(
    JSON.stringify({ fp: fingerprint, k: [value === null ? '' : String(value), id] }),
  )
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}
/** Keyset continuation after `after`, with nulls sorted last in either direction. */
function afterKeyset(
  expression: RawBuilder<unknown>,
  after: TableKeyset,
  { key, descending }: TableSort,
) {
  const [value, id] = after;
  if (value === '') return sql<boolean>`${expression} is null and id > ${id}::uuid`;
  const typed = key === p.PERFORMANCE_SORT_KEY_DIMENSION ? value : Number(value);
  if (typeof typed === 'number' && !Number.isFinite(typed)) badCursor();
  return sql<boolean>`(${expression} ${sql.raw(descending ? '<' : '>')} ${typed} or (${expression} = ${typed} and id > ${id}::uuid) or ${expression} is null)`;
}

export async function getPerformanceTable(
  db: Database,
  options: Scope & {
    snapshot_id: string;
    dimension?: string | null;
    sort?: string | null;
    cursor?: string | null;
    page_size?: number | null;
    compare_snapshot_id?: string | null;
  },
) {
  const dimension = choice(
    'dimension',
    options.dimension,
    p.PERFORMANCE_DEFAULT_DIMENSION,
    p.PERFORMANCE_DIMENSIONS,
  );
  const pageSize = tablePageSize(options.page_size);
  const order = tableSort(dimension, options.sort);
  const filters = {
    dimension,
    page_size: String(pageSize),
    project_id: options.projectId,
    snapshot_id: options.snapshot_id,
    sort: order.sort,
  };
  const fingerprint = hash(JSON.stringify({ f: filters, s: 'performance-table' })).slice(0, 16);
  const after = options.cursor ? decodeTableCursor(options.cursor, fingerprint) : null;
  const snapshot = await snapshots(db, options)
    .where('id', '=', options.snapshot_id)
    .executeTakeFirst();
  const empty = { dimension, items: [], next_cursor: null, total_count: 0, page_size: pageSize };
  if (!snapshot) return empty;
  const byDimensionKey = order.key === p.PERFORMANCE_SORT_KEY_DIMENSION;
  const expression = byDimensionKey
    ? sql<string>`dimension_key`
    : sql<number>`(metrics ->> ${order.key})::double precision`;
  const stats = (snapshotId: string) =>
    new WorkspaceScope(options.workspaceId)
      .selectFrom(db, 'performance_dimension_stats')
      .selectAll()
      .where('project_id', '=', options.projectId)
      .where('snapshot_id', '=', snapshotId)
      .where('dimension', '=', dimension);
  let query = stats(options.snapshot_id);
  if (after) query = query.where(afterKeyset(expression, after, order));
  const fetched = await query
    .orderBy(sql`${expression} ${sql.raw(order.descending ? 'desc' : 'asc')} nulls last`)
    .orderBy('id')
    .limit(pageSize + 1)
    .execute();
  const rows = fetched.slice(0, pageSize);
  const comparisons =
    options.compare_snapshot_id && rows.length
      ? await stats(options.compare_snapshot_id)
          .where(
            'dimension_key',
            'in',
            rows.map((r) => r.dimension_key),
          )
          .execute()
      : [];
  const peers = new Map(comparisons.map((r) => [r.dimension_key, tableMetrics(r.metrics)]));
  const sortValue = (row: (typeof rows)[number]) =>
    byDimensionKey ? row.dimension_key : numberOrNull(record(row.metrics)[order.key]);
  const last = rows.at(-1);
  const nextCursor =
    fetched.length > pageSize && last
      ? encodeTableCursor(fingerprint, sortValue(last), last.id)
      : null;
  return {
    dimension,
    items: rows.map((r) => ({
      dimension_key: r.dimension_key,
      display_value: r.display_value,
      metrics: tableMetrics(r.metrics),
      comparison_metrics: peers.get(r.dimension_key) ?? null,
    })),
    next_cursor: nextCursor,
    total_count: integer(record(snapshot.dimension_counts)[dimension]) ?? 0,
    page_size: pageSize,
  };
}
