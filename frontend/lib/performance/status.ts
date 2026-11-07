/**
 * Performance job states — the one owner (F7): the display-only range
 * projection task and the post-connect readiness ladder.
 */
import type { PerformanceRangeTaskStatus } from '@citeladder/contracts';
import type { ProjectReadinessStage } from '@/lib/api/performance';
import type { RunStatusValue } from '@/components/ui/badge';
import { RANGE_TASK_POLL_MS, READINESS_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';

/**
 * Every range-task queue status. Every terminal status releases the poll — a
 * failed or cancelled task that stayed pending would leave the surface
 * reporting work that has already stopped.
 */
export const RANGE_TASK_STATES = {
  queued: { label: 'Queued', badge: 'queued', active: true },
  leased: { label: 'Starting', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  retry_wait: { label: 'Retrying', badge: 'running', active: true },
  succeeded: { label: 'Succeeded', badge: 'completed', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
} as const satisfies JobStates<PerformanceRangeTaskStatus, RunStatusValue>;

/**
 * The range-task poll cadence. The caller reads a task it already enqueued, so
 * an unread task keeps polling: a failed first read must not leave the
 * projection pending forever.
 */
export const pollRangeTask = (status: PerformanceRangeTaskStatus | undefined) =>
  status === undefined
    ? RANGE_TASK_POLL_MS
    : pollWhileActive(RANGE_TASK_STATES, RANGE_TASK_POLL_MS, status);

/**
 * Which readiness stages advance on their own. Only `analysis_ready`,
 * `import_failed` and `not_connected` are settled; everything else is work in
 * flight — including `core_data_ready`, where the search numbers have landed
 * but CiteLadder's analysis is still computing. Polling only the earlier
 * rungs left the ladder stuck one step short of ready until the reader
 * reloaded the page.
 */
const READINESS_STAGES = {
  not_connected: { active: false },
  connected: { active: true },
  importing: { active: true },
  import_failed: { active: false },
  core_data_ready: { active: true },
  analysis_ready: { active: false },
} as const satisfies Readonly<Record<ProjectReadinessStage, { active: boolean }>>;

/** While an import is in flight the answer changes on its own, so the ladder keeps asking. */
export const pollReadiness = (stage: ProjectReadinessStage | undefined) =>
  pollWhileActive(READINESS_STAGES, READINESS_POLL_MS, stage);
