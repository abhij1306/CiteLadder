import { agentPolicy, AgentError } from './contracts.ts';
import { AgentQueue } from './queue.ts';
import { AgentRuntime } from './runtime.ts';
import { leaseSignal, maintainLease } from '../queue/heartbeat.ts';
import { getLogger } from '../logging.ts';
import type { TurnEvents } from './stream.ts';

/** Why the caller stopped a turn: its time ran out, or the browser left. */
function stoppedCode(signal: AbortSignal) {
  const reason: unknown = signal.reason;
  return reason instanceof DOMException && reason.name === 'TimeoutError'
    ? 'turn_timeout'
    : 'interrupted';
}

/**
 * One turn, executed once inside the browser's request. A failure or a stop
 * ends it with its reply; nothing schedules a replay, so a turn never runs twice.
 */
export async function runAgentOnce(
  queue: AgentQueue,
  runtime: AgentRuntime,
  owner: string,
  workspaceIds: readonly string[],
  options: { runId?: string; signal?: AbortSignal; events?: TurnEvents } = {},
) {
  if (options.signal?.aborted) return false;
  const claimed = await queue.claim(owner, workspaceIds, options.runId);
  if (!claimed) return false;
  let lease;
  try {
    lease = await queue.start(claimed, owner);
  } catch (error) {
    getLogger('workers.agent').exception('agent_start_failed', error, { run_id: claimed.id });
    return true;
  }
  const heartbeat = maintainLease(
    () => queue.heartbeat(lease),
    agentPolicy.heartbeat_seconds * 1000,
  );
  try {
    await runtime.execute(lease, leaseSignal(heartbeat.signal, options.signal), options.events);
    // A lost lease belongs to recovery; a caller's stop is answered here while the lease holds.
    if (options.signal?.aborted && !heartbeat.signal.aborted)
      await runtime.fail(lease, stoppedCode(options.signal));
  } catch (error) {
    if (!(error instanceof AgentError && error.code === 'lease')) throw error;
  } finally {
    await heartbeat.stop();
  }
  return true;
}
