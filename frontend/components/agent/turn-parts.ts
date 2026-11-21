import type { AgentMessage } from '@/lib/api/agent';

export type TurnPart =
  | Readonly<{ kind: 'steps'; steps: AgentMessage['steps'] }>
  | Readonly<{ kind: 'text'; markdown: string }>
  | Readonly<{ kind: 'evidence'; refs: AgentMessage['evidence_refs'] }>
  | Readonly<{ kind: 'sources'; sources: AgentMessage['web_sources'] }>
  | Readonly<{ kind: 'outputs' }>;

export function turnParts(message: AgentMessage): TurnPart[] {
  return [
    ...(message.steps.length ? [{ kind: 'steps', steps: message.steps } as const] : []),
    { kind: 'text', markdown: message.content },
    { kind: 'evidence', refs: message.evidence_refs },
    ...(message.web_sources.length
      ? [{ kind: 'sources', sources: message.web_sources } as const]
      : []),
    { kind: 'outputs' },
  ];
}
