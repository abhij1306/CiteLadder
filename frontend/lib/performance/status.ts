import type { PerformanceRangeTaskStatus } from '@citeladder/contracts';
import type { ProjectReadinessStage } from '@/lib/api/performance';
import type { RunStatusValue } from '@/components/ui/status-mark';
import { RANGE_TASK_POLL_MS, READINESS_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';

export const RANGE_TASK_STATES = {
  queued: { label: 'Queued', badge: 'queued', active: true },
  leased: { label: 'Starting', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  retry_wait: { label: 'Retrying', badge: 'running', active: true },
  succeeded: { label: 'Succeeded', badge: 'completed', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
} as const satisfies JobStates<PerformanceRangeTaskStatus, RunStatusValue>;

export const pollRangeTask = (status: PerformanceRangeTaskStatus | undefined) =>
  status === undefined
    ? RANGE_TASK_POLL_MS
    : pollWhileActive(RANGE_TASK_STATES, RANGE_TASK_POLL_MS, status);

const READINESS_STAGES = {
  not_connected: { active: false },
  connected: { active: true },
  importing: { active: true },
  import_failed: { active: false },
  core_data_ready: { active: true },
  analysis_ready: { active: false },
} as const satisfies Readonly<Record<ProjectReadinessStage, { active: boolean }>>;

export const pollReadiness = (stage: ProjectReadinessStage | undefined) =>
  pollWhileActive(READINESS_STAGES, READINESS_POLL_MS, stage);
