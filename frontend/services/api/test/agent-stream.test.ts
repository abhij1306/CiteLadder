import { describe, expect, it } from 'vitest';
import { documentEmitter, type TurnDocument } from '../src/agent/stream.ts';

function emitted(inputs: { title?: string; body?: string }[]) {
  const events: TurnDocument[] = [];
  const emit = documentEmitter(2, (event) => events.push(event), 4);
  for (const input of inputs) emit(input);
  return events;
}

describe('documentEmitter', () => {
  it('sends a growing body as the text added since the last event', () => {
    expect(
      emitted([
        { title: 'Plan', body: 'Draft' },
        { title: 'Plan', body: 'Draft wi' },
        { title: 'Plan', body: 'Draft with more' },
      ]),
    ).toEqual([
      { ordinal: 2, title: 'Plan', from: 0, text: 'Draft' },
      { ordinal: 2, title: 'Plan', from: 5, text: ' with more' },
    ]);
  });

  it('sends the whole body from 0 when it no longer extends the sent one', () => {
    expect(
      emitted([
        { title: 'Plan', body: 'Draft one' },
        { title: 'Plan', body: 'Draft two, longer' },
      ]),
    ).toEqual([
      { ordinal: 2, title: 'Plan', from: 0, text: 'Draft one' },
      { ordinal: 2, title: 'Plan', from: 0, text: 'Draft two, longer' },
    ]);
  });
});
