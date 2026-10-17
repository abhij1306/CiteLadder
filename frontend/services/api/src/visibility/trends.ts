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
import { loadMeasuredRuns, trendSource, type RunScope } from './runs.ts';
import { TrendQueryError, validateEngineAndRange, validateCohort } from './selection.ts';
import { bucketPoints, rawPoint, type TrendPoint } from './trend-folding.ts';

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
  const runs = await loadMeasuredRuns(db, scope, {
    fromAt: query.fromAt && toUtc(query.fromAt),
    toAt: query.toAt && toUtc(query.toAt),
  });
  const sources = runs
    .map((run) => trendSource(run, query.logicalEngine, query.cohort))
    .filter((source) => source !== null)
    // Slices match the exact frozen identity, so a multi-model point never
    // lands in a model slice.
    .filter(
      (source) =>
        (query.transportModel === null || source.transportModel === query.transportModel) &&
        (query.retrievalEnabled === null || source.retrievalEnabled === query.retrievalEnabled),
    );
  if (sources.length === 0) return [];
  // Cap points, not runs: capping runs first would silently drop whole
  // weeks or months from a bucketed view. The newest points stay, in order.
  const points = (
    query.granularity === 'run' ? sources.map(rawPoint) : bucketPoints(sources, query.granularity)
  ).slice(-visibility.trend_max_points);
  const marks = await rankingMarks(db, scope.projectId);
  for (const point of points) applyMarks(point.rankings, marks);
  return points;
}
