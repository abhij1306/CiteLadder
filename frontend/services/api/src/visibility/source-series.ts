/**
 * How often each leading source was used, bucketed over the selection.
 *
 * The time axis is run
 * completion (`coalesce(completed_at, created_at)`), the denominator per
 * bucket is every response observed in it, and each leading source gets a
 * dense line: a bucket where it went uncited is a real zero.
 */
import { sql } from 'kysely';

import type { Database } from '../db/database.ts';
import { wireUtc, utcText } from '../db/timestamps.ts';
import { authorizedSelection, evidenceScope, observedAt, type RunSelection } from './selection.ts';
import { compareText } from '../text-order.ts';

/** Lines a reader can tell apart; the design system's categorical chart tokens. */
export const SOURCE_SERIES_MAX_SERIES = 5;

export type SourceDimension = 'domain' | 'url';
export type SeriesGranularity = 'day' | 'week' | 'month';

type SourceSeriesPoint = { at: string; responses: number; share: number | null };
type SourceSeries = { key: string; citations: number; points: SourceSeriesPoint[] };
export type SourceSeriesResponse = {
  dimension: SourceDimension;
  granularity: string;
  buckets: string[];
  series: SourceSeries[];
};

/** One grouped `(source, bucket)` row; `bucket` is the UTC wire rendering. */
type SeriesRow = { key: string; bucket: string; responses: number; citations: number };

/** Fold the grouped rows into one dense series per leading source. */
function assembleSeries(
  rows: readonly SeriesRow[],
  input: {
    totals: ReadonlyMap<string, number>;
    dimension: SourceDimension;
    granularity: string;
    limit: number;
  },
): SourceSeriesResponse {
  const buckets = [...input.totals.keys()].sort(compareText);
  const ranked = new Map<string, number>();
  for (const row of rows) ranked.set(row.key, (ranked.get(row.key) ?? 0) + row.citations);
  const leading = [...ranked.entries()]
    .sort(([leftKey, left], [rightKey, right]) => right - left || compareText(leftKey, rightKey))
    .slice(0, input.limit)
    .map(([key]) => key);
  const byKey = new Map(leading.map((key) => [key, new Map<string, number>()]));
  for (const row of rows) byKey.get(row.key)?.set(row.bucket, row.responses);
  return {
    dimension: input.dimension,
    granularity: input.granularity,
    buckets,
    series: leading.map((key) => ({
      key,
      citations: ranked.get(key)!,
      points: buckets.map((at) => {
        const responses = byKey.get(key)!.get(at) ?? 0;
        const total = input.totals.get(at)!;
        return { at, responses, share: total ? responses / total : null };
      }),
    })),
  };
}

export async function getSourceSeries(
  db: Database,
  requested: RunSelection,
  options: {
    dimension: SourceDimension;
    granularity: SeriesGranularity;
    domain: string | null;
    /** One page's own line, for its detail view. */
    url?: string | null;
    sourceClass: string | null;
    limit: number;
  },
): Promise<SourceSeriesResponse> {
  const selection = await authorizedSelection(db, requested);
  // Buckets are UTC days/weeks, whatever the session time zone is.
  const bucket = sql`date_trunc(${options.granularity}, ${observedAt}, 'UTC')`;
  const scope = evidenceScope(db, selection)
    .select(['ra.id as analysis_id', bucket.as('bucket')])
    .as('scope');
  const totalRows = await db
    .selectFrom(scope)
    .select([
      utcText(sql.ref('scope.bucket')).as('bucket'),
      sql<string>`count(distinct scope.analysis_id)`.as('responses'),
    ])
    .groupBy('scope.bucket')
    .execute();
  const empty = { dimension: options.dimension, granularity: options.granularity };
  if (totalRows.length === 0) return { ...empty, buckets: [], series: [] };
  // A URL series is keyed by page, and a page is filtered by its own format
  // exactly as the URL table is; a publisher class would match nothing.
  const pages = options.dimension === 'url' || Boolean(options.domain);
  const key = options.dimension === 'url' ? 'citation.url' : 'citation.domain';
  let counted = db
    .selectFrom('citations as citation')
    .innerJoin(scope, 'scope.analysis_id', 'citation.analysis_id')
    .where('citation.workspace_id', '=', selection.workspaceId)
    .where(key, 'is not', null)
    .where(key, '!=', '');
  if (options.domain) counted = counted.where('citation.domain', '=', options.domain);
  if (options.url) counted = counted.where('citation.url', '=', options.url);
  if (options.sourceClass) {
    counted = pages
      ? counted
          .innerJoin('source_pages as page', (join) =>
            join
              .onRef('page.url_hash', '=', 'citation.url_hash')
              .on('page.workspace_id', '=', selection.workspaceId)
              .on('page.project_id', '=', selection.projectId),
          )
          .where('page.page_format', '=', options.sourceClass)
      : counted.where('citation.source_class', '=', options.sourceClass);
  }
  const rows = await counted
    .select([
      sql<string>`${sql.ref(key)}`.as('key'),
      utcText(sql.ref('scope.bucket')).as('bucket'),
      sql<string>`count(distinct citation.analysis_id)`.as('responses'),
      sql<string>`count(citation.id)`.as('citations'),
    ])
    .groupBy([key, 'scope.bucket'])
    .execute();
  return assembleSeries(
    rows.map((row) => ({
      key: row.key,
      bucket: wireUtc(row.bucket!),
      responses: Number(row.responses),
      citations: Number(row.citations),
    })),
    {
      ...empty,
      totals: new Map(totalRows.map((row) => [wireUtc(row.bucket!), Number(row.responses)])),
      limit: Math.max(1, Math.min(options.limit, SOURCE_SERIES_MAX_SERIES)),
    },
  );
}
