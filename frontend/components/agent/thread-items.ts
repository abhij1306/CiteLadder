import { runOutcome } from '@/lib/agent/run-state';
import type { AgentChatDetail, AgentMessage } from '@/lib/api/agent';

type EndedOutcome = 'failed' | 'stopped_at_limit' | 'cancelled';
export type FailureOutcome = EndedOutcome | 'unknown';

type FailureItem = {
  kind: 'failure';
  request: AgentMessage | null;
  failures: [AgentMessage, ...AgentMessage[]];
  outcome: FailureOutcome;
};

type ThreadItem = { kind: 'message'; message: AgentMessage } | FailureItem;

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

function takeRequest(items: ThreadItem[]): AgentMessage | null {
  const before = items.at(-1);
  const request =
    before?.kind === 'message' && before.message.role === 'user' ? before.message : null;
  if (request) items.pop();
  return request;
}

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
