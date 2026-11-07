/** Dataset-aware successor admission, inside the sync completion transaction. */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { enqueueCoalesced, enqueueTask } from '../queue/enqueue.ts';

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
async function enqueueTrafficRefresh(trx: Database, run: CompletedSync) {
  const start = run.window_start.slice(0, 10);
  const end = run.window_end.slice(0, 10);
  await enqueueCoalesced(trx, {
    workspaceId: run.workspace_id,
    projectId: run.project_id,
    kind: 'traffic_snapshot_refresh',
    payload: { window_start: start, window_end: end, source_revision: run.id },
    coalesceOn: ['window_start', 'window_end'],
    delaySeconds: 0,
    keyParts: [run.project_id, start, end, run.resync_seq, run.id],
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
    });
  }
  if (failed || artifacts.some((artifact) => trafficDatasets.has(artifact.dataset)))
    await enqueueTrafficRefresh(trx, run);
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
    });
}
