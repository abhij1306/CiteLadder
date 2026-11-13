import { runOutcome } from '@/lib/agent/run-state';
import type { AgentChatDetail, AgentMessage } from '@/lib/api/agent';

/** How the latest run ended, when it ended without an answer. */
type EndedOutcome = 'failed' | 'stopped_at_limit' | 'cancelled';
/** `unknown`: an earlier turn, whose run's outcome the chat read does not carry. */
export type FailureOutcome = EndedOutcome | 'unknown';

type FailureItem = {
  kind: 'failure';
  /** The request the attempts answered, shown once; null for a reply with no request before it. */
  request: AgentMessage | null;
  /** Consecutive identical attempts' replies, oldest first. */
  failures: [AgentMessage, ...AgentMessage[]];
  outcome: FailureOutcome;
};

type ThreadItem = { kind: 'message'; message: AgentMessage } | FailureItem;

/**
 * A reply the run wrote because it ended without an answer. Every reply the
 * model wrote records at least its model call in `steps`; the reply a failed,
 * stopped or cancelled run leaves records nothing — no steps, evidence, web
 * pages or document — so it is told apart by structure, never by its words.
 */
function isUnansweredReply(message: AgentMessage, placed: ReadonlySet<string>): boolean {
  return (
    message.role === 'agent' &&
    message.steps.length === 0 &&
    message.evidence_refs.length === 0 &&
    message.web_sources.length === 0 &&
    !placed.has(message.id)
  );
}

function sameRequest(left: AgentMessage, right: AgentMessage): boolean {
  return (
    left.content === right.content &&
    left.skill_id === right.skill_id &&
    left.mentions.map((mention) => mention.id).join() ===
      right.mentions.map((mention) => mention.id).join()
  );
}

function endedOutcome(run: AgentChatDetail['latest_run']): EndedOutcome | null {
  const kind = runOutcome(run).kind;
  return kind === 'failed' || kind === 'stopped_at_limit' || kind === 'cancelled' ? kind : null;
}

/** Takes the user request just before an unanswered reply off the end of the thread. */
function takeRequest(items: ThreadItem[]): AgentMessage | null {
  const before = items.at(-1);
  const request =
    before?.kind === 'message' && before.message.role === 'user' ? before.message : null;
  if (request) items.pop();
  return request;
}

/** The failure this attempt repeats: the same request, ended with the same words. */
function repeatedFailure(
  previous: ThreadItem | undefined,
  request: AgentMessage | null,
  message: AgentMessage,
): FailureItem | null {
  if (!request || previous?.kind !== 'failure' || !previous.request) return null;
  return sameRequest(previous.request, request) &&
    previous.failures.at(-1)?.content === message.content
    ? previous
    : null;
}

/**
 * The thread in order, each unanswered turn as its request and a failure
 * rather than a reply. Consecutive turns that repeat the same request and end
 * the same way collapse into one, counting the attempts. Only the latest run's
 * outcome is known, so only the last turn's failure says how it ended.
 */
export function threadItems(detail: AgentChatDetail, placed: ReadonlySet<string>): ThreadItem[] {
  const items: ThreadItem[] = [];
  const last = detail.messages.at(-1);
  const latest = endedOutcome(detail.latest_run);
  for (const message of detail.messages) {
    if (!isUnansweredReply(message, placed)) {
      items.push({ kind: 'message', message });
      continue;
    }
    const outcome = message === last && latest ? latest : 'unknown';
    const request = takeRequest(items);
    const previous = repeatedFailure(items.at(-1), request, message);
    if (previous) {
      previous.failures.push(message);
      previous.outcome = outcome;
      continue;
    }
    items.push({ kind: 'failure', request, failures: [message], outcome });
  }
  return items;
}
