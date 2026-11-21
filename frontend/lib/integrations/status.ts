import type { IntegrationSyncRun } from '@/lib/api/integrations';
import type { RunStatusValue } from '@/components/ui/status-mark';
import { SYNC_RUN_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';

type SyncRunStatus = IntegrationSyncRun['status'];

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

export function isSyncInFlight(run: SyncRunProgress): boolean {
  return SYNC_RUN_STATES[run.status].active || run.processing;
}

export function pollSyncRun(run: SyncRunProgress | undefined): number | false {
  if (!run || run.processing) return SYNC_RUN_POLL_MS;
  return pollWhileActive(SYNC_RUN_STATES, SYNC_RUN_POLL_MS, run.status);
}
