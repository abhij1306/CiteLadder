import type { AgentChatDetail, AgentOutput } from '@/lib/api/agent';

export function documentAnchor(outputId: string): string {
  return `document-${outputId}`;
}

export function latestOutput(detail: Pick<AgentChatDetail, 'outputs'>): AgentOutput | undefined {
  let latest: AgentOutput | undefined;
  for (const output of detail.outputs) {
    if (!latest || revisionTime(output) > revisionTime(latest)) latest = output;
  }
  return latest;
}

export function outputPlacements(detail: Pick<AgentChatDetail, 'outputs' | 'messages'>): {
  byMessage: ReadonlyMap<string, readonly AgentOutput[]>;
  unplaced: readonly AgentOutput[];
} {
  const byMessage = new Map<string, AgentOutput[]>();
  const unplaced: AgentOutput[] = [];
  for (const output of detail.outputs) {
    const messageId = output.message_id ?? replyBefore(detail, output);
    if (!messageId) unplaced.push(output);
    else byMessage.set(messageId, [...(byMessage.get(messageId) ?? []), output]);
  }
  return { byMessage, unplaced };
}

function replyBefore(detail: Pick<AgentChatDetail, 'messages'>, output: AgentOutput) {
  const written = revisionTime(output);
  return [...detail.messages]
    .reverse()
    .find((message) => message.role === 'agent' && Date.parse(message.created_at) <= written)?.id;
}

function revisionTime(output: AgentOutput): number {
  return Date.parse(output.latest_revision.created_at);
}
