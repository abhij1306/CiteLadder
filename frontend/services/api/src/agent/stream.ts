/**
 * Live events of a turn in progress. Display only: the settlement transaction
 * saves the validated message and revision, and nothing here is persisted.
 */
import type { z } from 'zod';
import type { agentTurnEventSchema } from '@citeladder/contracts/agent';
import { record } from '../db/json.ts';

// The wire contract owns these shapes; the route adds the `type` tag.
type TurnEvent = z.input<typeof agentTurnEventSchema>;
type Payload<T extends TurnEvent['type']> = Omit<Extract<TurnEvent, { type: T }>, 'type'>;
export type TurnDocument = Payload<'document_delta'>;
type TurnTool = Payload<'tool'>;
/** Optional listeners for one execution; the worker passes none. */
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

/**
 * Turns a streamed `save_document` input into throttled document snapshots.
 * Each event resends the document so far, so a long one is sampled less often:
 * about every 5% once it passes a few thousand characters.
 */
export function documentEmitter(ordinal: number, emit: (event: TurnDocument) => void, every = 160) {
  let sentAt = -1;
  let title: string | null = null;
  return (input: unknown) => {
    const body = field(input, 'body');
    const next = field(input, 'title');
    const length = body?.length ?? 0;
    if (next === title && length - sentAt < Math.max(every, length / 20)) return;
    sentAt = length;
    title = next;
    emit({ ordinal, title: next, body });
  };
}
