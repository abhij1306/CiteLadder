import type { NetSentiment } from '@citeladder/contracts/visibility';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getVisibility, type DashboardQuery, type VisibilityResponse } from './dashboard.ts';
import { groupedSentiments, perceivedAnswers, sentimentsOf } from './perception.ts';
import { marketOf, type RunScope } from './runs.ts';
import type { RunSelection } from './selection.ts';
import type { TrendPoint } from './trend-folding.ts';

type Entity = { name: string; is_brand: boolean; sentiment: NetSentiment };

const NOT_NAMED: NetSentiment = {
  mentions: 0,
  classified: 0,
  positive: 0,
  negative: 0,
  net_sentiment: null,
};

function withSentiment<Row extends { name: string; is_brand: boolean }>(
  rows: readonly Row[],
  entities: readonly Entity[] | null,
): (Row & { sentiment: NetSentiment | null })[] {
  if (entities === null) return rows.map((row) => ({ ...row, sentiment: null }));
  const brand = entities.find((entity) => entity.is_brand);
  const competitors = new Map(
    entities.filter((entity) => !entity.is_brand).map((entity) => [entity.name, entity]),
  );
  return rows.map((row) => ({
    ...row,
    sentiment: (row.is_brand ? brand : competitors.get(row.name))?.sentiment ?? NOT_NAMED,
  }));
}

function selectionOf(
  scope: RunScope,
  query: Pick<DashboardQuery, 'logicalEngine' | 'cohort'>,
  runs: Pick<RunSelection, 'auditId' | 'auditIds'>,
): RunSelection {
  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    marketId: marketOf(scope),
    ...runs,
    logicalEngine: query.logicalEngine,
    cohort: query.cohort,
    topicId: scope.topicId ?? null,
    fromAt: null,
    toAt: null,
  };
}

export async function getRankedVisibility(
  db: Database,
  scope: RunScope,
  query: DashboardQuery,
): Promise<VisibilityResponse> {
  const view = await getVisibility(db, scope, query);
  const pooled = view.selection_mode === 'range' ? (view.source_audit_ids ?? []) : null;
  if (pooled?.length === 0) return view;
  const answers = await perceivedAnswers(
    db,
    selectionOf(scope, query, { auditId: pooled ? null : view.audit_id, auditIds: pooled }),
  );
  return {
    ...view,
    rankings: withSentiment(view.rankings, answers === null ? null : sentimentsOf(answers)),
  };
}

function coveredFrom(groups: readonly (readonly string[])[]): number {
  const runs = new Set<string>();
  for (let index = groups.length - 1; index >= 0; index--) {
    const next = new Set([...runs, ...(groups[index] ?? [])]);
    if (next.size > policy.visibility.selection_max_runs) return index + 1;
    for (const id of next) runs.add(id);
  }
  return 0;
}

export async function withPointSentiments(
  db: Database,
  scope: RunScope,
  query: { logicalEngine: string | null; cohort: string },
  points: TrendPoint[],
): Promise<TrendPoint[]> {
  const groups = points.map((point) => point.source_audit_ids ?? []);
  const first = coveredFrom(groups);
  const covered = groups.slice(first);
  const auditIds = [...new Set(covered.flat())];
  const sentiments = auditIds.length
    ? await groupedSentiments(db, selectionOf(scope, query, { auditId: null, auditIds }), covered)
    : [];
  return points.map((point, index) => ({
    ...point,
    rankings: withSentiment(point.rankings, sentiments[index - first] ?? null),
  }));
}
