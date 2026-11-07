import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { budget, spendBudget } from '../src/abuse/usage.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const before = new Date('2026-01-01T12:59:59.950Z'),
  after = new Date('2026-01-01T13:00:00.050Z');
afterAll(async () => {
  // The fixture windows sit in the past, apart from any live window.
  await db
    .deleteFrom('usage_windows')
    .where('operation', '=', 'bulk_import')
    .where('window_started_at', 'in', [
      new Date('2026-01-01T12:00:00.000Z'),
      new Date('2026-01-01T13:00:00.000Z'),
    ])
    .execute();
  await db.destroy();
});
it('atomically admits five per fixed window and rejects oversized first consumption', async () => {
  const imports = budget('bulk_import', { ABUSE_BULK_IMPORT_LIMIT: '5' });
  const subject = randomUUID();
  const attempt = (at: Date) =>
    spendBudget(db, imports, subject, { at }).then(
      () => true,
      () => false,
    );
  expect(
    (await Promise.all(Array.from({ length: 12 }, () => attempt(before)))).filter(Boolean),
  ).toHaveLength(5);
  expect(
    (await Promise.all(Array.from({ length: 6 }, () => attempt(after)))).filter(Boolean),
  ).toHaveLength(5);
  const other = randomUUID();
  await expect(spendBudget(db, imports, other, { amount: 6, at: before })).rejects.toMatchObject({
    status: 429,
  });
  await spendBudget(db, imports, other, { amount: 5, at: before });
});
