import { expect, it } from 'vitest';
import { auditSlots } from '../src/audits/freeze.ts';

const key = (s: { prompt: number; engine: string; repetition: number }) =>
  `${s.prompt}:${s.engine}:${s.repetition}`;
it.each(['0', '42', '18446744073709551615'])(
  'orders every slot exactly once, deterministically, for seed %s',
  (seed) => {
    const slots = auditSlots(2, ['chatgpt', 'claude'], 3, seed);
    expect(slots.map(key)).toEqual(auditSlots(2, ['chatgpt', 'claude'], 3, seed).map(key));
    const expected = new Set<string>();
    for (const prompt of [0, 1])
      for (const engine of ['chatgpt', 'claude'])
        for (const repetition of [0, 1, 2]) expected.add(`${prompt}:${engine}:${repetition}`);
    expect(slots).toHaveLength(12);
    expect(new Set(slots.map(key))).toEqual(expected);
  },
);
it('uses the seed to vary the order', () => {
  const orders = new Set(
    ['0', '42', '18446744073709551615'].map((seed) =>
      auditSlots(2, ['chatgpt', 'claude'], 3, seed).map(key).join(),
    ),
  );
  expect(orders.size).toBeGreaterThan(1);
});
