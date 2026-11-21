import type { VisibilityMatrix } from '@citeladder/contracts/visibility-matrix';

import type { Database } from '../db/database.ts';
import { brandTopics } from '../prompts/brand-topics.ts';
import { listMarkets } from '../projects/markets.ts';
import { selectionRuns, type DashboardQuery } from './dashboard.ts';
import { matrixProjection, type MatrixRun } from './matrix-cells.ts';
import { perceivedAnswers } from './perception.ts';
import { applyIdentities, brandIdentities } from './brand-identities.ts';
import type { RunScope } from './runs.ts';
import { AnalysisNotFoundError } from './selection.ts';

type Query = Omit<DashboardQuery, 'baselineId'>;

async function latestRun(db: Database, scope: RunScope, query: Query, own: boolean) {
  const runs = await selectionRuns(
    db,
    scope,
    own
      ? query
      : {
          ...query,
          auditId: null,
          configurationKey: null,
          selectionMode: query.selectionMode === 'range' ? 'range' : 'latest',
        },
  ).catch((error: unknown) => {
    if (!own && error instanceof AnalysisNotFoundError) return [];
    throw error;
  });
  return runs.at(-1) ?? null;
}

async function stripMarket(db: Database, scope: RunScope, query: Query) {
  if (query.selectionMode === 'range' || query.auditId === null) return scope.marketId ?? null;
  const named = await db
    .selectFrom('audits')
    .select('market_id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', query.auditId)
    .executeTakeFirst();
  return named ? named.market_id : (scope.marketId ?? null);
}

export async function getVisibilityMatrix(
  db: Database,
  scope: RunScope,
  query: Query,
): Promise<VisibilityMatrix> {
  const [markets, stripId] = await Promise.all([
    listMarkets(db, scope),
    stripMarket(db, scope, query),
  ]);
  const strip = markets.findIndex((market) => market.id === stripId);
  if (strip === -1) throw new AnalysisNotFoundError('Market not found');
  const latest = await Promise.all(
    markets.map((market) =>
      latestRun(db, { ...scope, marketId: market.id }, query, market.id === stripId),
    ),
  );
  const auditIds = latest.flatMap((run) => (run ? [run.auditId] : []));
  const [topics, blocks, answers, marks] = await Promise.all([
    brandTopics(db, scope).select(['id', 'name']).execute(),
    auditIds.length === 0
      ? Promise.resolve([])
      : db
          .selectFrom('audit_topic_metrics')
          .select(['audit_id', 'topic_id', 'topic_name', 'metrics'])
          .where('workspace_id', '=', scope.workspaceId)
          .where('project_id', '=', scope.projectId)
          .where('audit_id', 'in', auditIds)
          .execute(),
    Promise.all(
      latest.map((run, index) =>
        run
          ? perceivedAnswers(db, {
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
              marketId: markets[index]?.id ?? null,
              auditId: run.auditId,
              auditIds: null,
              logicalEngine: null,
              cohort: query.cohort,
              fromAt: null,
              toAt: null,
              topicId: null,
            })
          : Promise.resolve(null),
      ),
    ),
    brandIdentities(db, scope),
  ]);
  const runs = markets.map((market, index): MatrixRun => {
    const run = latest[index];
    return {
      market: { id: market.id, label: market.label },
      run: run
        ? {
            auditId: run.auditId,
            metrics: run.metrics,
            topics: new Map(
              blocks
                .filter((block) => block.audit_id === run.auditId)
                .map((block) => [
                  block.topic_id,
                  { name: block.topic_name, metrics: block.metrics },
                ]),
            ),
            answers: answers[index] ?? null,
          }
        : null,
    };
  });
  const projection = matrixProjection({
    runs,
    strip,
    topicNames: new Map(topics.map((topic) => [topic.id, topic.name])),
    filters: { engine: query.logicalEngine, topic: scope.topicId ?? null, cohort: query.cohort },
  });
  applyIdentities(projection.axes.brand, marks);
  for (const row of Object.values(projection.rankings).flat())
    if (row.kind === 'measured') applyIdentities(row.leaders, marks);
  return { source_audit_ids: auditIds, ...projection };
}
