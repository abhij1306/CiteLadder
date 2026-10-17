import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { enforceWorkspaceRequest } from '../src/abuse/usage.ts';
import { testDatabase } from './support.ts';

const db = testDatabase(),
  operation = `fixture:${randomUUID()}`;
afterAll(async () => {
  await db.deleteFrom('usage_windows').where('operation', '=', operation).execute();
  await db.destroy();
});
it('atomically admits five per fixed window and rejects oversized first consumption', async () => {
  const subject = randomUUID(),
    settings = { operation, limit: 5, windowSeconds: 3600 };
  const attempt = (now: Date) =>
    enforceWorkspaceRequest(db, subject, settings, now).then(
      () => true,
      () => false,
    );
  const before = new Date('2026-01-01T12:59:59.950Z'),
    after = new Date('2026-01-01T13:00:00.050Z');
  expect(
    (await Promise.all(Array.from({ length: 12 }, () => attempt(before)))).filter(Boolean),
  ).toHaveLength(5);
  expect(
    (await Promise.all(Array.from({ length: 6 }, () => attempt(after)))).filter(Boolean),
  ).toHaveLength(5);
  const other = randomUUID();
  await expect(
    enforceWorkspaceRequest(db, other, { ...settings, amount: 6 }, before),
  ).rejects.toMatchObject({ status: 429 });
  await enforceWorkspaceRequest(db, other, { ...settings, amount: 5 }, before);
});
