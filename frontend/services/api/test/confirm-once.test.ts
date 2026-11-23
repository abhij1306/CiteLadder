import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, onTestFinished, vi } from 'vitest';
import { claimSeconds, confirmOnce, type ConfirmOnce } from '../src/changes/confirm-once.ts';
import { testConfig, testDatabase } from './support.ts';

const db = testDatabase(testConfig());
afterAll(() => db.destroy());

it('renews a live claim while its owner outlasts the claim window, so a later confirm is still refused instead of running the owner again', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const lapsed = new Date(Date.now() - (claimSeconds() + 60) * 1000);
  const claims: Date[] = [];
  const renewed = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let runs = 0;
  const steps: ConfirmOnce<null, string> = {
    live: true,
    subject: `confirm-once-test:${randomUUID()}`,
    busy: () => new Error('busy'),
    open: () => Promise.resolve(null),
    claimedAt: () => Promise.resolve(claims.at(-1) ?? null),
    claim: () => {
      const at = claims.length ? new Date() : lapsed;
      claims.push(at);
      if (claims.length === 2) renewed.resolve();
      return Promise.resolve(at);
    },
    run: async () => {
      runs++;
      started.resolve();
      await finish.promise;
      return 'ran';
    },
    record: () => Promise.resolve(),
    release: () => Promise.resolve(),
  };

  const first = confirmOnce(db, steps);
  await started.promise;
  vi.advanceTimersByTime((claimSeconds() * 1000) / 3);
  await renewed.promise;
  await expect(confirmOnce(db, steps)).rejects.toThrow('busy');
  finish.resolve();
  expect(await first).toBe('ran');
  expect([runs, claims.length]).toEqual([1, 2]);
});
