/**
 * Sync-run polling idiom — the one owner (settings + traffic).
 *
 * Both the Settings→Integrations card (`POST /integrations/{id}/syncs`
 * on-demand runs) and the /traffic screen (`POST /projects/{id}/traffic/sync`
 * enqueuing one run per active mapped connection) poll each run via
 * `GET /integrations/{connection_id}/syncs/{sync_run_id}` at
 * `SYNC_RUN_POLL_MS` until the run reaches a terminal queue status — the
 * same 3s cadence as `ACTIVE_RUN_POLL_MS` in
 * `lib/visibility/use-visibility-dashboard.ts`.
 */
import type { IntegrationSyncRun } from '@/lib/api/integrations';
import type { RunStatusValue } from '@/components/ui/badge-variants';

/** Compatibility export for existing feature consumers. */
export { SYNC_RUN_POLL_MS } from '@/lib/config/operational';

type SyncRunStatus = IntegrationSyncRun['status'];

/** Non-terminal queue statuses — an active run keeps polling + disables Sync now. */
export function isActiveSyncRun(status: SyncRunStatus): boolean {
  return (
    status === 'queued' || status === 'leased' || status === 'running' || status === 'retry_wait'
  );
}

/**
 * A sync is still in flight until its import is terminal and the project's
 * post-sync projections have finished; until then the pages do not show it,
 * so polling continues and Sync now stays disabled.
 */
export function isSyncInFlight(run: Pick<IntegrationSyncRun, 'status' | 'processing'>): boolean {
  return isActiveSyncRun(run.status) || run.processing;
}

/** A terminal run succeeded only on the `succeeded` status. */
export function isSucceededSyncRun(status: SyncRunStatus): boolean {
  return status === 'succeeded';
}

/** Sync-run wire statuses rendered through the run-status badge family. */
export const SYNC_RUN_BADGE: Record<SyncRunStatus, RunStatusValue> = {
  queued: 'queued',
  leased: 'queued',
  running: 'running',
  retry_wait: 'running',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};
