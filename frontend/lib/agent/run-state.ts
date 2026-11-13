import type { AgentChatDetail, AgentRun } from '@/lib/api/agent';
import { AGENT_RUN_POLL_MAX_MS, AGENT_RUN_POLL_STEPS } from '@/lib/config/agent';

/** A page chat still reading its page: it has no turn yet, and nothing can be sent. */
export function isPageReading(pageFetch: AgentChatDetail['page_fetch'] | undefined): boolean {
  return pageFetch?.status === 'reading';
}

/**
 * The first turn of a page chat, which the server queued once the page was
 * read and no request of this tab started: the chat screen opens its stream.
 */
export function fetchedTurnToStart(detail: AgentChatDetail | undefined): string | null {
  const run = detail?.latest_run;
  if (detail?.page_fetch?.status !== 'done' || detail.chat.turn_count !== 1) return null;
  return run?.status === 'queued' ? run.id : null;
}

const ACTIVE_STATUSES = new Set<AgentRun['status']>(['queued', 'leased', 'running', 'retry_wait']);

/** A turn the server may still be working on; the UI polls until it ends. */
export function isRunActive(run: AgentRun | null | undefined): boolean {
  return run ? ACTIVE_STATUSES.has(run.status) : false;
}

/** How often to read an active run that this tab is not streaming, by its age. */
export function runPollMs(run: AgentRun, now = Date.now()): number {
  const age = now - Date.parse(run.created_at);
  return AGENT_RUN_POLL_STEPS.find((step) => age < step.untilMs)?.everyMs ?? AGENT_RUN_POLL_MAX_MS;
}

export type RunOutcome =
  | { kind: 'none' }
  | { kind: 'running'; run: AgentRun; queued: boolean }
  | { kind: 'succeeded' }
  | { kind: 'cancelled' }
  | { kind: 'stopped_at_limit'; detail: string }
  | { kind: 'failed'; code: string; detail: string };

/** The one state the conversation shows for the latest run. */
export function runOutcome(run: AgentRun | null | undefined): RunOutcome {
  if (!run) return { kind: 'none' };
  if (isRunActive(run)) return { kind: 'running', run, queued: run.status === 'queued' };
  if (run.status === 'succeeded') return { kind: 'succeeded' };
  if (run.status === 'cancelled') return { kind: 'cancelled' };
  if (run.error_code === 'stopped_at_limit')
    return { kind: 'stopped_at_limit', detail: run.error_detail };
  return { kind: 'failed', code: run.error_code, detail: run.error_detail };
}
