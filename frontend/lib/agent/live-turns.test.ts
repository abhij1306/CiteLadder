import { expect, it } from 'vite-plus/test';

import { applyTurnEvent, liveTurn, type TurnEvent } from './live-turns';

const fold = (events: TurnEvent[]) => events.reduce(applyTurnEvent, liveTurn(0));

it('appends one call’s reply and thinking, and lets a later call’s text replace them', () => {
  const turn = fold([
    { type: 'step', ordinal: 1 },
    { type: 'thinking', ordinal: 1, text: 'Checking ' },
    { type: 'thinking', ordinal: 1, text: 'the data' },
    { type: 'reply_delta', ordinal: 1, text: 'Reading ' },
    { type: 'reply_delta', ordinal: 1, text: 'first.' },
  ]);
  expect(turn).toMatchObject({
    step: 1,
    thinking: { ordinal: 1, text: 'Checking the data' },
    reply: { ordinal: 1, text: 'Reading first.' },
  });
  // A new call keeps the earlier text until it writes its own.
  const next = fold([
    { type: 'reply_delta', ordinal: 1, text: 'Reading first.' },
    { type: 'step', ordinal: 2 },
  ]);
  expect(next.reply).toEqual({ ordinal: 1, text: 'Reading first.' });
  expect(applyTurnEvent(next, { type: 'reply_delta', ordinal: 2, text: 'Answer' }).reply).toEqual({
    ordinal: 2,
    text: 'Answer',
  });
});

it('tracks each parallel call by its id and keeps the newest document snapshot', () => {
  const turn = fold([
    { type: 'tool', ordinal: 1, call_id: 'a', tool: 'read_site_health', status: 'started' },
    { type: 'tool', ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'started' },
    { type: 'tool', ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'unavailable' },
    { type: 'document_delta', ordinal: 2, title: 'Plan', body: 'Draft' },
    { type: 'document_delta', ordinal: 2, title: 'Plan', body: 'Draft with more' },
  ]);
  expect(turn.tools).toEqual([
    { ordinal: 1, call_id: 'a', tool: 'read_site_health', status: 'started' },
    { ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'unavailable' },
  ]);
  expect(turn.document).toEqual({ title: 'Plan', body: 'Draft with more' });
});
