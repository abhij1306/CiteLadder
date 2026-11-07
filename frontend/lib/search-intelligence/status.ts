/**
 * Search Intelligence analysis-run states — the one owner (F7).
 *
 * The page polls readiness while its latest run is active, and the run notice
 * and cost history name a run's status from this record.
 */
import type { SearchRunStatus } from '@citeladder/contracts';
import type { RunStatusValue } from '@/components/ui/badge';
import { SEARCH_INTELLIGENCE_RUN_POLL_MS } from '@/lib/config/operational';
import { pollWhileActive, type JobStates } from '@/lib/jobs/poll';

/**
 * Every analysis-run status. A reviewed run waits for the reader to confirm
 * its cost, so it is not active: nothing changes until they act. `uncertain`
 * reads as a warning like `partial`: a request may have been charged without
 * its result arriving.
 */
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

/** The page's poll cadence: while its latest analysis run is still sending requests. */
export const pollSearchRun = (status: SearchRunStatus | undefined) =>
  pollWhileActive(SEARCH_RUN_STATES, SEARCH_INTELLIGENCE_RUN_POLL_MS, status);
