import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { toUtc, type ParsedDatetime } from '../http/datetimes.ts';
import { applyIdentities, brandIdentities } from './brand-identities.ts';
import { withPointSentiments } from './ranking-sentiment.ts';
import {
  loadMeasuredRuns,
  trendSource,
  type MeasuredRun,
  type RunScope,
  type TrendSource,
} from './runs.ts';
import { TrendQueryError, validateEngineAndRange, validateCohort } from './selection.ts';
import { withTrendEvents } from './trend-events.ts';
import { bucketPoints, bucketStart, rawPoint, type TrendPoint } from './trend-folding.ts';

const visibility = policy.visibility;

export type TrendQuery = {
  logicalEngine: string | null;
  fromAt: ParsedDatetime | null;
  toAt: ParsedDatetime | null;
  granularity: string;
  transportModel: string | null;
  retrievalEnabled: boolean | null;
  cohort: string;
};

function sliceSource(run: MeasuredRun, query: TrendQuery): TrendSource | null {
  const source = trendSource(run, query.logicalEngine, query.cohort);
  if (source === null) return null;
  if (query.transportModel !== null && source.transportModel !== query.transportModel) return null;
  if (query.retrievalEnabled !== null && source.retrievalEnabled !== query.retrievalEnabled)
    return null;
  return source;
}

async function newestSources(
  db: Database,
  scope: RunScope,
  query: TrendQuery,
): Promise<TrendSource[]> {
  const bound = visibility.trend_max_runs;
  const window = {
    fromAt: query.fromAt && toUtc(query.fromAt),
    toAt: query.toAt && toUtc(query.toAt),
  };
  const newestFirst: TrendSource[] = [];
  let olderThan: string | undefined;
  while (newestFirst.length <= bound) {
    const page = await loadMeasuredRuns(db, scope, { ...window, newest: bound + 1, olderThan });
    for (const run of page.toReversed()) {
      const source = sliceSource(run, query);
      if (source !== null) newestFirst.push(source);
    }
    const [oldest] = page;
    if (oldest === undefined || page.length <= bound) break;
    olderThan = oldest.auditId;
  }
  const [cut, ...kept] = newestFirst.slice(0, bound + 1).toReversed();
  if (cut === undefined || newestFirst.length <= bound) return newestFirst.toReversed();
  if (query.granularity === 'run') return kept;
  const cutBucket = bucketStart(cut.completedAt, query.granularity);
  return kept.filter((source) => bucketStart(source.completedAt, query.granularity) > cutBucket);
}

export async function getVisibilityTrends(
  db: Database,
  scope: RunScope,
  query: TrendQuery,
): Promise<TrendPoint[]> {
  if (!visibility.trend_granularities.includes(query.granularity)) {
    throw new TrendQueryError(`Unsupported granularity: ${query.granularity}`);
  }
  if (query.transportModel !== null && !query.transportModel.trim()) {
    throw new TrendQueryError("'transport_model' must be a non-empty model id");
  }
  validateEngineAndRange(query);
  validateCohort(query.cohort);
  const sources = await newestSources(db, scope, query);
  if (sources.length === 0) return [];
  const points = (
    query.granularity === 'run' ? sources.map(rawPoint) : bucketPoints(sources, query.granularity)
  ).slice(-visibility.trend_max_points);
  const marks = await brandIdentities(db, scope);
  for (const point of points) applyIdentities(point.rankings, marks);
  const withEvents = await withTrendEvents(db, scope, sources, points);
  return withPointSentiments(db, scope, query, withEvents);
}
