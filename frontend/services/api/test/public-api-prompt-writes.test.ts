import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, expect, it } from 'vitest';

import { auditTenant } from './audit-fixtures.ts';
import { prompt, topic } from './prompt-fixtures.ts';
import { publicApiHarness } from './public-api-support.ts';

const { db, fixtures, withApiAccess, createKey, api } = publicApiHarness();

afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

it('changes a selection of prompts in one call and refuses one naming another workspace’s prompt', async () => {
  const tenant = await withApiAccess(await auditTenant(db, fixtures));
  const trail = await topic(db, tenant.projectId, 'Trail running');
  const mine = await prompt(db, tenant.setId, 'Which trail shoes grip wet rock?', {
    status: 'archived',
  });
  const foreign = await auditTenant(db, fixtures);
  const theirs = await prompt(db, foreign.setId, 'Which trail shoes drain fast?', {
    status: 'archived',
  });
  const { secret } = await createKey(tenant, { scopes: ['prompts:write'] });
  const root = `/projects/${tenant.projectId}`;
  const send = (path: string, body: unknown) =>
    api(secret, `${root}${path}`, { body, idempotencyKey: randomUUID() });
  const rows = async () =>
    (
      await db
        .selectFrom('prompts')
        .select(['id', 'status', 'topic_id'])
        .where('id', 'in', [mine, theirs])
        .execute()
    )
      .map((row) => `${row.id === mine ? 'mine' : 'theirs'} ${row.status} ${row.topic_id}`)
      .sort();
  const status = `/prompt-sets/${tenant.setId}/prompts/bulk-status`;

  const refused = await Promise.all([
    send(status, { prompt_ids: [mine, theirs], status: 'active' }),
    send('/prompts/bulk-topic', { prompt_ids: [mine, theirs], topic_id: trail }),
    send('/prompts/bulk-delete', { prompt_ids: [mine, theirs] }),
  ]);
  expect(refused.map((response) => response.status)).toEqual([404, 404, 404]);
  expect(await rows()).toEqual(['mine archived null', 'theirs archived null']);

  const filed = await send('/prompts/bulk-topic', { prompt_ids: [mine], topic_id: trail });
  expect([filed.status, await filed.json()]).toEqual([200, { count: 1 }]);
  const activated = await send(status, { prompt_ids: [mine], status: 'active' });
  expect(activated.status).toBe(200);
  expect(await rows()).toEqual([`mine active ${trail}`, 'theirs archived null']);
  const deleted = await send('/prompts/bulk-delete', { prompt_ids: [mine] });
  expect([deleted.status, await deleted.json()]).toEqual([200, { count: 1 }]);
  expect(await rows()).toEqual(['theirs archived null']);
});
