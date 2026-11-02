/**
 * The cross-run visibility trend: one point per run, or per UTC bucket.
 *
 * A projection of the project's persisted snapshots; a project with no matching
 * history is an empty list, never an error. An explicit model or retrieval
 * slice filters sources before anything is folded.
 */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { toUtc, type ParsedDatetime } from '../http/datetimes.ts';
import { applyMarks, rankingMarks } from './ranking-marks.ts';
import {
  loadMeasuredRuns,
  trendSource,
  type MeasuredRun,
  type RunScope,
  type TrendSource,
} from './runs.ts';
import { TrendQueryError, validateEngineAndRange, validateCohort } from './selection.ts';
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

/** The run as a source of this slice, or null when the slice excludes it. */
function sliceSource(run: MeasuredRun, query: TrendQuery): TrendSource | null {
  const source = trendSource(run, query.logicalEngine, query.cohort);
  // Slices match the exact frozen identity, so a multi-model point never
  // lands in a model slice.
  if (source === null) return null;
  if (query.transportModel !== null && source.transportModel !== query.transportModel) return null;
  if (query.retrievalEnabled !== null && source.retrievalEnabled !== query.retrievalEnabled)
    return null;
  return source;
}

/**
 * The slice's newest `trend_max_runs` sources in the window, oldest first.
 * Runs are read newest first, a page of `trend_max_runs + 1` at a time, and
 * the slice filters each page, so a narrow slice still reaches its older
 * runs. One source past the bound shows where history was cut: it leaves the
 * trend and, in a bucketed view, so does every source sharing its bucket, so
 * no point folds part of a bucket.
 */
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
    // A short page is the end of the window's history.
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
  // Cap points after folding, so a run-heavy week is still one point and
  // never crowds out the weeks before it. The newest points stay, in order.
  const points = (
    query.granularity === 'run' ? sources.map(rawPoint) : bucketPoints(sources, query.granularity)
  ).slice(-visibility.trend_max_points);
  const marks = await rankingMarks(db, scope.projectId);
  for (const point of points) applyMarks(point.rankings, marks);
  return points;
}
