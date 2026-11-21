/**
 * Live events of a turn in progress. Display only: the turn's final transaction
 * saves the validated message and revision, and nothing here is persisted.
 */
import type { z } from 'zod';
import type { agentTurnEventSchema } from '@citeladder/contracts/agent';
import { record } from '../db/json.ts';

type TurnEvent = z.input<typeof agentTurnEventSchema>;
type Payload<T extends TurnEvent['type']> = Omit<Extract<TurnEvent, { type: T }>, 'type'>;
export type TurnDocument = Payload<'document_delta'>;
type TurnTool = Payload<'tool'>;
export type TurnEvents = {
  step?: (event: Payload<'step'>) => void;
  reply?: (event: Payload<'reply_delta'>) => void;
  document?: (event: TurnDocument) => void;
  thinking?: (event: Payload<'thinking'>) => void;
  tool?: (event: TurnTool) => void;
};

const field = (input: unknown, name: string) => {
  const value = record(input)[name];
  return typeof value === 'string' ? value : null;
};

export function documentEmitter(ordinal: number, emit: (event: TurnDocument) => void, every = 160) {
  let sent: string | null = null;
  let sentAt = -1;
  let title: string | null = null;
  return (input: unknown) => {
    const body = field(input, 'body');
    const next = field(input, 'title');
    const length = body?.length ?? 0;
    if (next === title && length - sentAt < Math.max(every, length / 20)) return;
    const from = body !== null && sent !== null && body.startsWith(sent) ? sent.length : 0;
    sent = body;
    sentAt = length;
    title = next;
    emit({ ordinal, title: next, from, text: body?.slice(from) ?? null });
  };
}
