/** Dataset-aware successor admission, inside the sync completion transaction. */
import { sql } from 'kysely';
import { policy, resolveSettingSpec } from '../config.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import { enqueueTask } from '../referrals/enqueue.ts';

type CompletedSync = {
  id: string;
  workspace_id: string;
  project_id: string;
  window_start: string;
  window_end: string;
  resync_seq: number;
};

/**
 * A refresh rebuilds its window's snapshots from every stored row, so one still
 * queued for the same window already covers this run; a started one gets a
 * successor. Imports of GSC and GA4, or a burst of syncs, share one refresh.
 */
async function enqueueTrafficRefresh(trx: Database, run: CompletedSync, maxAttempts: number) {
  const start = run.window_start.slice(0, 10);
  const end = run.window_end.slice(0, 10);
  await subjectXactLock(trx, `traffic_snapshot_enqueue:${run.project_id}`);
  const pending = await trx
    .selectFrom('analytics_tasks')
    .select('id')
    .where('workspace_id', '=', run.workspace_id)
    .where('project_id', '=', run.project_id)
    .where('task_kind', '=', 'traffic_snapshot_refresh')
    .where('status', '=', policy.task_queue.statuses.queued)
    .where(sql<string>`payload->>'window_start'`, '=', start)
    .where(sql<string>`payload->>'window_end'`, '=', end)
    // Held until this run commits, so a worker cannot claim and finish the
    // refresh before this run's rows are visible to it.
    .forUpdate()
    .executeTakeFirst();
  if (pending) return;
  await enqueueTask(trx, {
    workspaceId: run.workspace_id,
    projectId: run.project_id,
    kind: 'traffic_snapshot_refresh',
    payload: { window_start: start, window_end: end, source_revision: run.id },
    keyParts: [run.project_id, start, end, run.resync_seq, run.id],
    maxAttempts,
  });
}

export async function enqueuePostSyncProjections(
  trx: Database,
  run: CompletedSync,
  failed = false,
): Promise<void> {
  const artifacts = await trx
    .selectFrom('integration_import_artifacts')
    .select(['id', 'dataset'])
    .where('sync_run_id', '=', run.id)
    .where('workspace_id', '=', run.workspace_id)
    .execute();
  const maxAttempts = resolveSettingSpec(
    policy.analytics.worker_settings.task_max_attempts,
  ) as number;
  const referralDatasets = new Set(policy.traffic.TRAFFIC_GA4_REFERRAL_DATASETS);
  const trafficDatasets = new Set(policy.traffic.TRAFFIC_REFRESH_TRIGGER_DATASETS);
  const referralExtraDatasets = new Set(policy.traffic.AI_REFERRALS_REFRESH_TRIGGER_DATASETS);
  for (const artifact of artifacts) {
    if (!referralDatasets.has(artifact.dataset)) continue;
    await enqueueTask(trx, {
      workspaceId: run.workspace_id,
      projectId: run.project_id,
      kind: 'ingest_referrals',
      payload: { import_artifact_id: artifact.id },
      keyParts: [run.project_id, artifact.id],
      maxAttempts,
    });
  }
  if (failed || artifacts.some((artifact) => trafficDatasets.has(artifact.dataset)))
    await enqueueTrafficRefresh(trx, run, maxAttempts);
  // A run with referral datasets refreshes AI Referrals at the end of its
  // ingest → classify chain, after classification; refreshing here as well
  // would run first and publish every bucket as pending.
  const chained = artifacts.some((artifact) => referralDatasets.has(artifact.dataset));
  if (!chained && (failed || artifacts.some((a) => referralExtraDatasets.has(a.dataset))))
    await enqueueTask(trx, {
      workspaceId: run.workspace_id,
      projectId: run.project_id,
      kind: 'ai_referrals_snapshot_refresh',
      payload: {
        window_start: run.window_start.slice(0, 10),
        window_end: run.window_end.slice(0, 10),
      },
      keyParts: [run.project_id, run.id, failed ? 'failed' : 'ga4-extras'],
      maxAttempts,
    });
}
