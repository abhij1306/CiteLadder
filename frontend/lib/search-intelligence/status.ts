import type { SearchRunStatus } from '@citeladder/contracts';
import type { RunStatusValue } from '@/components/ui/status-mark';
import { SEARCH_INTELLIGENCE_RUN_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';

export const SEARCH_RUN_STATES = {
  reviewed: { label: 'Awaiting confirmation', badge: 'draft', active: false },
  queued: { label: 'Queued', badge: 'queued', active: true },
  running: { label: 'Running', badge: 'running', active: true },
  succeeded: { label: 'Complete', badge: 'completed', active: false },
  partial: { label: 'Stopped early', badge: 'partial', active: false },
  failed: { label: 'Failed', badge: 'failed', active: false },
  uncertain: { label: 'Outcome unknown', badge: 'partial', active: false },
  cancelled: { label: 'Cancelled', badge: 'cancelled', active: false },
} as const satisfies JobStates<SearchRunStatus, RunStatusValue>;

export const pollSearchRun = (status: SearchRunStatus | undefined) =>
  pollWhileActive(SEARCH_RUN_STATES, SEARCH_INTELLIGENCE_RUN_POLL_MS, status);
