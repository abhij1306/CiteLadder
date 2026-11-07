/**
 * The queue owner's lane logs: one `lane_task_failed` record per failed
 * attempt and one `lane_lease_lost` record per lost lease, with the same
 * fields on every lane. A record carries the failure's class and code, never
 * its message: provider messages can echo request or response bodies.
 */
import { failureFacts, getLogger } from '../logging.ts';

const logger = getLogger('queue.lanes');

type LaneTask = { id: string; workspace_id: string; attempt_count: number };

type LaneFailure = {
  /** Where the attempt was when it failed. */
  phase: string;
  /** `performance.now()` when the attempt began. */
  startedAt: number;
  /** The settled attempt's number, when it differs from the claimed row's count. */
  attempt?: number;
  /** Whether the attempt will retry; absent when the lane's domain owner decides later. */
  outcome?: 'retry' | 'failed';
  error?: unknown;
  /** The persisted error code, used when the failure carries no code of its own. */
  code?: string;
  /** Lane-specific bounded facts (a status, a reason code); never a message or body. */
  facts?: Readonly<Record<string, string | number | null | undefined>>;
};

export function logLaneFailure(lane: string, task: LaneTask, failure: LaneFailure): void {
  const facts =
    failure.error === undefined
      ? { error_class: null, error_code: null }
      : failureFacts(failure.error);
  logger.warning('lane_task_failed', {
    ...failure.facts,
    lane,
    task_id: task.id,
    workspace_id: task.workspace_id,
    attempt: failure.attempt ?? task.attempt_count,
    phase: failure.phase,
    outcome: failure.outcome ?? null,
    elapsed_ms: Math.round(performance.now() - failure.startedAt),
    error_class: facts.error_class,
    error_code: facts.error_code ?? failure.code ?? null,
  });
}

/**
 * The lease this worker held ended without its own settle: `heartbeat` when a
 * renewal was refused, `fence` when a write found the lease gone. The attempt
 * is null when the row's status could not be read.
 */
export function logLeaseLost(
  lane: string,
  task: Omit<LaneTask, 'attempt_count'> & { attempt_count: number | null },
  phase: 'heartbeat' | 'fence',
): void {
  logger.warning('lane_lease_lost', {
    lane,
    task_id: task.id,
    workspace_id: task.workspace_id,
    attempt: task.attempt_count,
    phase,
  });
}
