import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { policy } from '../config.ts';
import { enqueueOpportunityRefresh } from '../opportunities/enqueue.ts';
import {
  payloadWindow,
  payloadString,
  requireProject,
  taskProject,
  type Executor,
} from '../workers/executor.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { record, strings } from '../db/json.ts';
import { buildQueryEvidence } from './query-evidence.ts';
import { classifyProjectQueries, normalizeQuery } from './classification.ts';
import { queryDetectorInputs, sourceMaterial, trafficSource } from './source.ts';
import {
  detectSearchSignals,
  detectStrikingDistance,
  stableHash,
  unique,
  type Evaluation,
} from './projection.ts';
import { detectCannibalization, detectCtrGap, detectTrends } from './detectors.ts';
import { compareText } from '../text-order.ts';

const p = policy.demand;
async function downstream(db: Database, task: QueueTask, id: string, maxAttempts: number) {
  const kind = payloadString(task, 'downstream_trigger_kind') ?? 'demand_snapshot';
  const triggerId = payloadString(task, 'downstream_trigger_id') ?? id;
  await enqueueOpportunityRefresh(db, {
    workspaceId: task.workspace_id,
    projectId: requireProject(task),
    triggerKind: kind,
    triggerId,
    maxAttempts,
  });
}

export const recomputeDemand: Executor = async (task, { db, maxAttempts, checkCancelled }) => {
  const scope = {
    workspaceId: task.workspace_id,
    projectId: await taskProject(db, task),
    ...payloadWindow(task),
  };
  await checkCancelled('demand projection');
  await db.transaction().execute(async (trx) => {
    // Concurrent retries must publish one immutable snapshot, not fail a uniqueness race.
    await subjectXactLock(trx, `demand_snapshot:${scope.projectId}`);
    const query = await buildQueryEvidence(trx, scope);
    const traffic = await trafficSource(trx, scope);
    const inputs = await queryDetectorInputs(trx, scope, query.id);
    const evaluations: Record<string, Evaluation> = {
      striking_distance: detectStrikingDistance(inputs),
      cannibalization: detectCannibalization(inputs),
      property_relative_ctr_gap: detectCtrGap(inputs),
      query_trends: detectTrends(inputs, scope.windowEnd),
    };
    const searchClasses = await classifyProjectQueries(
      trx,
      scope.workspaceId,
      scope.projectId,
      traffic.inputs.filter((r) => r.target_kind === 'query').map((r) => r.target),
    );
    const candidates = [
      ...detectSearchSignals(traffic.inputs, (query) => searchClasses.get(normalizeQuery(query))),
      ...Object.values(evaluations).flatMap((e) => e.candidates),
    ];
    const sourceHash = stableHash(
      await sourceMaterial(trx, scope, traffic, inputs, query.source_hash.slice(0, 24)),
    );
    const workspace = new WorkspaceScope(scope.workspaceId);
    const existing = await workspace
      .selectFrom(trx, 'demand_snapshots')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .where('source_hash', '=', sourceHash)
      .executeTakeFirst();
    if (existing) {
      await downstream(trx, task, existing.id, maxAttempts);
      return;
    }
    const prior = await workspace
      .selectFrom(trx, 'demand_snapshots')
      .select(['id', 'summary'])
      .where('project_id', '=', scope.projectId)
      .orderBy('window_end', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const counts: Record<string, number> = {};
    for (const c of candidates) counts[c.signal_type] = (counts[c.signal_type] ?? 0) + 1;
    const detectorSummary = Object.fromEntries(
      Object.entries(evaluations)
        .sort(([a], [b]) => compareText(a, b))
        .map(([name, e]) => [
          name,
          {
            state: e.state,
            counts_by_classification: e.counts_by_classification,
            limitations: e.limitations,
          },
        ]),
    );
    const id = randomUUID();
    await trx
      .insertInto('demand_snapshots')
      .values({
        id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        window_start: scope.windowStart,
        window_end: scope.windowEnd,
        source_hash: sourceHash,
        prior_snapshot_id: prior?.id ?? null,
        source_artifact_ids: JSON.stringify(
          unique([
            ...strings(query.source_artifact_ids),
            ...traffic.inputs.flatMap((r) => r.source_artifact_ids),
          ]),
        ),
        source_metric_row_ids: JSON.stringify(
          unique([
            ...strings(query.source_metric_row_ids),
            ...traffic.inputs.flatMap((r) => r.source_metric_row_ids),
          ]),
        ),
        coverage: JSON.stringify({
          search: traffic.snapshot ? 'observed' : 'unavailable',
          query_evidence: evaluations.striking_distance!.state,
        }),
        summary: JSON.stringify({
          signal_count: candidates.length,
          counts_by_type: counts,
          detectors: detectorSummary,
        }),
        comparison: prior
          ? JSON.stringify({
              prior_snapshot_id: prior.id,
              signal_count_delta:
                candidates.length - Number(record(prior.summary).signal_count ?? 0),
              causality: 'not_asserted',
            })
          : null,
        formula_version: p.DEMAND_FORMULA_VERSION,
        analyzer_version: p.DEMAND_ANALYZER_VERSION,
        created_at: new Date(),
      })
      .execute();
    const size = policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE;
    for (let i = 0; i < candidates.length; i += size)
      await trx
        .insertInto('demand_signals')
        .values(
          candidates.slice(i, i + size).map((c) => ({
            ...c,
            id: randomUUID(),
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            snapshot_id: id,
            evidence: JSON.stringify(c.evidence),
            metrics: JSON.stringify(c.metrics),
            coverage: JSON.stringify(c.coverage),
            limitations: JSON.stringify(c.limitations),
            priority_inputs: JSON.stringify(c.priority_inputs),
            analyzer_version: p.DEMAND_ANALYZER_VERSION,
            rule_version: p.DEMAND_RULE_VERSION,
            formula_version: p.DEMAND_FORMULA_VERSION,
            created_at: new Date(),
          })),
        )
        .execute();
    await downstream(trx, task, id, maxAttempts);
  });
};
