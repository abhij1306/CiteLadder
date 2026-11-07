/**
 * Integration sync-run states — the one owner (F7).
 *
 * Both the Settings→Integrations card (`POST /integrations/{id}/syncs`
 * on-demand runs) and the /traffic screen (`POST /projects/{id}/traffic/sync`
 * enqueuing one run per active mapped connection) poll each run via
 * `GET /integrations/{connection_id}/syncs/{sync_run_id}` until it is no
 * longer in flight.
 */
import type { IntegrationSyncRun } from '@/lib/api/integrations';
import type { RunStatusValue } from '@/components/ui/badge';
import { SYNC_RUN_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';

type SyncRunStatus = IntegrationSyncRun['status'];

/**
 * Every sync-run queue status: its label, its run-status badge, and whether
 * the import is still moving (an active run keeps polling and disables Sync
 * now). A run being retried still reads as running.
 */
export const SYNC_RUN_STATES = {
  queued: { label: 'Queued', badge: 'queued', active: true },
  leased: { label: 'Starting', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  retry_wait: { label: 'Retrying', badge: 'running', active: true },
  succeeded: { label: 'Succeeded', badge: 'completed', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
} as const satisfies JobStates<SyncRunStatus, RunStatusValue>;

type SyncRunProgress = Pick<IntegrationSyncRun, 'status' | 'processing'>;

/**
 * A sync is still in flight until its import is terminal and the project's
 * post-sync projections have finished; until then the pages do not show it,
 * so polling continues and Sync now stays disabled.
 */
export function isSyncInFlight(run: SyncRunProgress): boolean {
  return SYNC_RUN_STATES[run.status].active || run.processing;
}

/**
 * The sync-run poll cadence: while the import runs or its reports are still
 * rebuilding. Every caller reads a run it already enqueued, so an unread run
 * keeps polling: a failed first read must not leave the sync without an outcome.
 */
export function pollSyncRun(run: SyncRunProgress | undefined): number | false {
  if (!run || run.processing) return SYNC_RUN_POLL_MS;
  return pollWhileActive(SYNC_RUN_STATES, SYNC_RUN_POLL_MS, run.status);
}
