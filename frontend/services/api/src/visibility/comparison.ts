/**
 * A selected run against its baseline: the nearest compatible earlier run,
 * or the one the reader named.
 *
 * Runs compare exactly when their frozen measurement
 * identity and versions match and both are fully covered; otherwise they
 * compare only on the like-for-like prompt/model/repetition cells both runs
 * answered, and say so in `status`.
 */
import type { visibilityComparisonSchema } from '@citeladder/contracts/visibility';
import type { z } from 'zod';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { executionFrozenProvenance } from '../analysis/provenance.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { wireUtc } from '../db/timestamps.ts';
import {
  cohortMetrics,
  engineMetrics,
  isComplete,
  measurementCounts,
  metricDeltas,
  metricValues,
  rankingRows,
  type Metrics,
  type RankingRow,
} from './metrics.ts';
import { loadMeasuredRuns, type MeasuredRun, type RunScope } from './runs.ts';
import { selectedCohorts } from './selection.ts';

export type VisibilityComparison = z.input<typeof visibilityComparisonSchema>;

export function emptyComparison(
  overrides: Partial<VisibilityComparison> = {},
): VisibilityComparison {
  return {
    status: 'no_baseline',
    baseline_audit_id: null,
    baseline_audit_ids: [],
    baseline_at: null,
    baseline_counts: null,
    current_counts: null,
    deltas: {},
    rankings: [],
    skipped_runs: 0,
    matched_cells: 0,
    current_cells: 0,
    baseline_cells: 0,
    current_values: {},
    baseline_values: {},
    current_rankings: [],
    ...overrides,
  };
}

/** The run being compared: its identity, completion and selected aggregate. */
export type SelectedRun = {
  auditId: string;
  workspaceId: string;
  configuration: unknown;
  completedAt: string | null;
  analyzerVersion: string;
  scoringRuleVersion: string;
  metrics: Metrics;
};

type Selector = { cohort: string; engine: string | null };

/** The frozen context two runs must share before any cell can be matched. */
const panelFreeKey = (configuration: unknown) =>
  frozenComparisonKey(configuration, null, false, false);

/**
 * Walk back from the selected run to the first compatible baseline. The walk
 * stops at the first match, so only the recent end of the history is read;
 * an explicitly named baseline may be older and is always reachable.
 */
export async function compareSelection(
  db: Database,
  scope: RunScope,
  current: SelectedRun,
  selector: Selector & { baselineId: string | null },
): Promise<VisibilityComparison> {
  const key = frozenComparisonKey(current.configuration, selector.engine);
  if (key === null) return emptyComparison({ status: 'identity_unavailable' });
  // Nothing precedes a run that never completed.
  if (current.completedAt === null) return emptyComparison();
  const candidates = await loadMeasuredRuns(db, scope, {
    fromAt: null,
    toAt: current.completedAt,
    ...(selector.baselineId ? {} : { newest: policy.visibility.selection_max_runs }),
  });
  let skipped = 0;
  for (const previous of candidates.toReversed()) {
    if (previous.auditId === current.auditId || previous.completedAt >= current.completedAt) {
      continue;
    }
    if (selector.baselineId && previous.auditId !== selector.baselineId) continue;
    const comparison = await candidateComparison(db, current, previous, selector, key);
    if (comparison !== null) return { ...comparison, skipped_runs: skipped };
    skipped += 1;
    if (selector.baselineId) {
      return emptyComparison({ status: 'changed_context', baseline_audit_id: previous.auditId });
    }
  }
  return emptyComparison({ skipped_runs: skipped });
}

async function candidateComparison(
  db: Database,
  current: SelectedRun,
  previous: MeasuredRun,
  selector: Selector,
  key: string,
): Promise<VisibilityComparison | null> {
  if (
    previous.analyzerVersion !== current.analyzerVersion ||
    previous.scoringRuleVersion !== current.scoringRuleVersion
  ) {
    return null;
  }
  if (frozenComparisonKey(previous.configuration, selector.engine) !== key) {
    return matchedComparison(db, current, previous, selector);
  }
  const exact = exactComparison(current.metrics, previous, selector);
  if (exact.status === 'partial_coverage') {
    return (await matchedComparison(db, current, previous, selector)) ?? exact;
  }
  return exact;
}

function exactComparison(
  metrics: Metrics,
  previous: MeasuredRun,
  selector: Selector,
): VisibilityComparison {
  const cohort = cohortMetrics(previous.metrics, selector.cohort);
  const before = selector.engine === null ? cohort : engineMetrics(cohort, selector.engine);
  const currentCounts = measurementCounts(metrics);
  const previousCounts = measurementCounts(before);
  let status = 'comparable';
  if (!currentCounts.responses || !previousCounts.responses) status = 'no_observations';
  else if (currentCounts.expected === null || previousCounts.expected === null) {
    status = 'coverage_unavailable';
  } else if (!(isComplete(currentCounts) && isComplete(previousCounts))) {
    status = 'partial_coverage';
  }
  return emptyComparison({
    status,
    baseline_audit_id: previous.auditId,
    baseline_audit_ids: [previous.auditId],
    baseline_at: wireUtc(previous.completedAt),
    baseline_counts: previousCounts,
    current_counts: currentCounts,
    rankings: rankingRows(before),
    deltas: status === 'comparable' ? metricDeltas(metrics, before) : {},
  });
}

/** One scored answer, keyed by the like-for-like cell it fills. */
export type ComparisonCell = {
  brandMentioned: boolean;
  ownedCited: boolean;
  score: Record<string, unknown>;
};

export type CellRun = { auditId: string; configuration: unknown; workspaceId: string };

/**
 * Each run's scored answers keyed by frozen prompt, route, retrieval,
 * repetition and versions. An answer with no frozen retrieval state, model or
 * score cannot be matched and is left out.
 */
export async function loadComparisonCells(
  db: Database,
  runs: { current: CellRun; previous: CellRun },
  selector: Selector,
): Promise<Map<string, Map<string, ComparisonCell>>> {
  const { current, previous } = runs;
  let query = db
    .selectFrom('response_analyses as ra')
    .innerJoin('audit_tasks as task', 'task.id', 'ra.task_id')
    .innerJoin('audit_prompt_snapshots as prompt', 'prompt.id', 'task.prompt_snapshot_id')
    .select([
      'ra.audit_id',
      'ra.logical_engine',
      'ra.transport_provider',
      'ra.transport_model',
      'ra.repetition',
      'ra.analyzer_version',
      'ra.scoring_rule_version',
      'ra.brand_mentioned',
      'ra.owned_domain_cited',
      'ra.score',
      'prompt.prompt_id',
      'prompt.text',
      'task.request_snapshot',
      'task.provider_route_snapshot',
    ])
    .where('ra.workspace_id', '=', current.workspaceId)
    .where('ra.audit_id', 'in', [current.auditId, previous.auditId])
    .where('ra.cohort', 'in', [...selectedCohorts(selector.cohort)]);
  if (selector.engine) query = query.where('ra.logical_engine', '=', selector.engine);
  const cells = new Map<string, Map<string, ComparisonCell>>([
    [current.auditId, new Map()],
    [previous.auditId, new Map()],
  ]);
  for (const row of await query.execute()) {
    const configuration =
      row.audit_id === current.auditId ? current.configuration : previous.configuration;
    const retrieval = executionFrozenProvenance({
      requestSnapshot: row.request_snapshot,
      routeSnapshot: row.provider_route_snapshot,
      auditConfiguration: configuration,
    });
    const score = record(row.score);
    if (retrieval === null || !row.transport_model || Object.keys(score).length === 0) continue;
    const key = JSON.stringify([
      row.prompt_id ?? row.text,
      row.text,
      row.logical_engine,
      row.transport_provider,
      row.transport_model,
      retrieval,
      row.repetition,
      row.analyzer_version,
      row.scoring_rule_version,
    ]);
    cells.get(row.audit_id)!.set(key, {
      brandMentioned: row.brand_mentioned,
      ownedCited: row.owned_domain_cited,
      score,
    });
  }
  return cells;
}

/** The prompt part of a cell key: the prompt identity and its frozen text. */
export function cellPrompt(key: string): string {
  const [identity, text] = JSON.parse(key) as [string, string];
  return JSON.stringify([identity, text]);
}

/** An aggregate of matched answers, shaped like a stored snapshot. */
function cellMetrics(rows: readonly ComparisonCell[], configuration: unknown): Metrics {
  const config = record(configuration);
  const brand =
    typeof config.brand_name === 'string' && config.brand_name ? config.brand_name : 'Brand';
  const names = (Array.isArray(config.competitors) ? config.competitors : []).map((entry) =>
    String(record(entry).name),
  );
  const counts: Record<string, number> = {
    [brand]: rows.filter((row) => row.brandMentioned).length,
  };
  const named = (name: string, field: string) =>
    rows.filter((row) => strings(row.score[field]).includes(name)).length;
  for (const name of names)
    counts[name] = (counts[name] ?? 0) + named(name, 'competitors_mentioned');
  const total = rows.length;
  const owned = rows.filter((row) => row.ownedCited).length;
  const presences = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    total_completed: total,
    brand_mention_count: counts[brand],
    owned_citation_response_count: owned,
    brand_mention_rate: counts[brand]! / total,
    owned_citation_rate: owned / total,
    competitor_mention_rate: Object.fromEntries(names.map((name) => [name, counts[name]! / total])),
    competitor_citation_rate: Object.fromEntries(
      names.map((name) => [name, named(name, 'competitor_domains_cited') / total]),
    ),
    share_of_voice: {
      mention_counts: counts,
      share: Object.fromEntries(
        Object.entries(counts).map(([name, count]) => [name, presences ? count / presences : null]),
      ),
    },
  };
}

/** Compare only the cells both runs answered, or null when they share none. */
export function compareCells(
  after: ReadonlyMap<string, ComparisonCell>,
  before: ReadonlyMap<string, ComparisonCell>,
  runs: { current: CellRun; previous: CellRun & { completedAt: string } },
): VisibilityComparison | null {
  const matched = [...after.keys()].filter((key) => before.has(key));
  if (matched.length === 0) return null;
  const current = cellMetrics(
    matched.map((key) => after.get(key)!),
    runs.current.configuration,
  );
  const previous = cellMetrics(
    matched.map((key) => before.get(key)!),
    runs.previous.configuration,
  );
  return emptyComparison({
    status: 'matched_subset',
    baseline_audit_id: runs.previous.auditId,
    baseline_at: wireUtc(runs.previous.completedAt),
    baseline_audit_ids: [runs.previous.auditId],
    current_counts: measurementCounts(current),
    baseline_counts: measurementCounts(previous),
    deltas: metricDeltas(current, previous),
    current_values: metricValues(current),
    baseline_values: metricValues(previous),
    rankings: rankingRows(previous),
    current_rankings: rankingRows(current),
    matched_cells: matched.length,
    current_cells: after.size,
    baseline_cells: before.size,
  });
}

/** Whether two runs share the frozen context cells can be matched within. */
export function sharesCellContext(current: unknown, previous: unknown): boolean {
  const context = panelFreeKey(current);
  return context !== null && context === panelFreeKey(previous);
}

async function matchedComparison(
  db: Database,
  current: SelectedRun,
  previous: MeasuredRun,
  selector: Selector,
): Promise<VisibilityComparison | null> {
  if (!sharesCellContext(current.configuration, previous.configuration)) return null;
  const runs = {
    current: current,
    previous: { ...previous, workspaceId: current.workspaceId },
  };
  const cells = await loadComparisonCells(db, runs, selector);
  return compareCells(cells.get(current.auditId)!, cells.get(previous.auditId)!, runs);
}

/** Apply a comparison's movement to the selected ranking rows, in place. */
export function applyRankingComparison(
  rankings: RankingRow[],
  comparison: VisibilityComparison,
  gaps: ReadonlyMap<string, number>,
): void {
  const baseline = new Map(comparison.rankings.map((row) => [row.name, row]));
  const matched = new Map(comparison.current_rankings.map((row) => [row.name, row]));
  for (const row of rankings) {
    row.gap_count = row.is_brand ? null : (gaps.get(row.name) ?? 0);
    const before = baseline.get(row.name);
    if (before === undefined || before.mention_rate === null) continue;
    if (comparison.status === 'comparable' && row.mention_rate !== null) {
      row.visibility_delta = (row.mention_rate - before.mention_rate) * 100;
    }
    const subset = matched.get(row.name);
    if (
      comparison.status === 'matched_subset' &&
      subset !== undefined &&
      subset.mention_rate !== null
    ) {
      row.matched_visibility_rate = subset.mention_rate;
      row.matched_visibility_delta = (subset.mention_rate - before.mention_rate) * 100;
      row.matched_response_count = comparison.matched_cells;
    }
  }
}

/** Answers per competitor that named it while the brand went unnamed. */
export async function competitorGaps(
  db: Database,
  input: {
    workspaceId: string;
    auditIds: readonly string[];
    cohort: string;
    engine: string | null;
  },
): Promise<Map<string, number>> {
  if (input.auditIds.length === 0) return new Map();
  let query = db
    .selectFrom('competitor_mentions as mention')
    .innerJoin('response_analyses as ra', 'ra.id', 'mention.analysis_id')
    .select(['mention.competitor_name', (eb) => eb.fn.count<string>('ra.id').distinct().as('gaps')])
    .where('ra.workspace_id', '=', input.workspaceId)
    .where('ra.audit_id', 'in', [...input.auditIds])
    .where('ra.brand_mentioned', '=', false)
    .where('ra.cohort', 'in', [...selectedCohorts(input.cohort)]);
  if (input.engine) query = query.where('ra.logical_engine', '=', input.engine);
  const rows = await query.groupBy('mention.competitor_name').execute();
  return new Map(rows.map((row) => [row.competitor_name, Number(row.gaps)]));
}
