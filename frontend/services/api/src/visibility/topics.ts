import type { VisibilityTopicRow, VisibilityTopics } from '@citeladder/contracts/visibility-topics';

import type { Database } from '../db/database.ts';
import { isNonEmpty, lastOf, type NonEmpty } from '../lists.ts';
import { brandTopics } from '../prompts/brand-topics.ts';
import { compareText } from '../text-order.ts';
import { selectionRuns, type DashboardQuery } from './dashboard.ts';
import { trendSource, type RunScope, type TrendSource } from './runs.ts';
import { foldBucket } from './trend-folding.ts';

type Measured = Extract<VisibilityTopicRow, { kind: 'measured' }>;

function measuredValues(
  sources: NonEmpty<TrendSource>,
): Omit<Measured, 'kind' | 'topic_id' | 'name' | 'renamed_from'> {
  const point = foldBucket(lastOf(sources).completedAt, sources);
  const brand = point.rankings.findIndex((row) => row.is_brand);
  const brandRow = point.rankings[brand];
  const named = brandRow?.share_of_voice != null;
  return {
    win_count: brandRow?.win_count ?? null,
    win_answers: brandRow?.win_answers ?? null,
    win_rate: brandRow?.win_rate ?? null,
    answers: point.counts?.responses ?? 0,
    visibility_rate: point.visibility_rate ?? null,
    share_of_voice: point.sov.mention,
    avg_position: point.avg_position ?? null,
    rank: named ? brand + 1 : null,
    ranked_brands: point.rankings.length,
  };
}

export async function getVisibilityTopics(
  db: Database,
  scope: RunScope,
  query: Omit<DashboardQuery, 'baselineId'>,
): Promise<VisibilityTopics> {
  const runs = await selectionRuns(db, scope, query);
  const [topics, blocks] = await Promise.all([
    brandTopics(db, scope).select(['id', 'name']).execute(),
    runs.length === 0
      ? []
      : db
          .selectFrom('audit_topic_metrics')
          .select(['id', 'audit_id', 'topic_id', 'topic_name', 'metrics', 'visibility_score'])
          .where('workspace_id', '=', scope.workspaceId)
          .where('project_id', '=', scope.projectId)
          .where(
            'audit_id',
            'in',
            runs.map((run) => run.auditId),
          )
          .execute(),
  ]);
  const runIndex = new Map(runs.map((run, index) => [run.auditId, index]));
  const sources = new Map<string, TrendSource[]>();
  const frozenNames = new Map<string, string[]>();
  for (const block of blocks) {
    const index = runIndex.get(block.audit_id) ?? -1;
    const run = runs[index];
    if (run === undefined) continue;
    const names = frozenNames.get(block.topic_id) ?? [];
    names[index] = block.topic_name;
    frozenNames.set(block.topic_id, names);
    const source = trendSource(
      {
        ...run,
        snapshotId: block.id,
        metrics: block.metrics,
        visibilityScore: block.visibility_score,
      },
      query.logicalEngine,
      query.cohort,
    );
    if (source === null) continue;
    sources.set(block.topic_id, [...(sources.get(block.topic_id) ?? []), source]);
  }
  const current = new Map(topics.map((topic) => [topic.id, topic.name]));
  const items = [...new Set([...current.keys(), ...frozenNames.keys()])]
    .map((topicId): VisibilityTopicRow => {
      const frozen = [...new Set((frozenNames.get(topicId) ?? []).filter(Boolean).toReversed())];
      const name = current.get(topicId) ?? frozen[0] ?? '';
      const identity = {
        topic_id: topicId,
        name,
        renamed_from: frozen.filter((value) => value !== name),
      };
      const measured = (sources.get(topicId) ?? []).toSorted(
        (left, right) => (runIndex.get(left.auditId) ?? 0) - (runIndex.get(right.auditId) ?? 0),
      );
      if (!isNonEmpty(measured)) return { kind: 'not_run', ...identity };
      return { kind: 'measured', ...identity, ...measuredValues(measured) };
    })
    .sort((left, right) => compareText(left.name, right.name));
  return { source_audit_ids: runs.map((run) => run.auditId), items };
}
