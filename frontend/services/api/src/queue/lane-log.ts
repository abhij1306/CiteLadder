import { failureFacts, getLogger } from '../logging.ts';

const logger = getLogger('queue.lanes');

type LaneTask = { id: string; workspace_id: string; attempt_count: number };

type LaneFailure = {
  phase: string;
  startedAt: number;
  attempt?: number;
  outcome?: 'retry' | 'failed';
  error?: unknown;
  code?: string;
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
