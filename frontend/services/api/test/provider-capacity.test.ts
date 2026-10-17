import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  acquireCapacity,
  releaseCapacity,
  type CapacityRequest,
} from '../src/providers/capacity.ts';
import { dataforseoAccountIdentity } from '../src/providers/dataforseo-identity.ts';
import { createSecretCipher } from '../src/integrations/fernet.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
const runtime = auditRuntime({});
const identities: string[] = [];
afterEach(async () => {
  if (identities.length)
    await db
      .deleteFrom('provider_capacity_buckets')
      .where('account_pool_identity', 'in', identities)
      .execute();
  identities.length = 0;
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});
async function seed() {
  const t = await auditTenant(db, fixtures);
  const [id] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
    {},
    runtime,
  );
  const tasks = await db
    .selectFrom('audit_tasks')
    .select('id')
    .where('audit_id', '=', id)
    .execute();
  const identity = randomUUID();
  identities.push(identity);
  const request: CapacityRequest = {
    taskId: tasks[0]!.id,
    attempt: 1,
    engine: 'chatgpt',
    transport: 'openai',
    connectionId: t.connectionId,
    accountPoolIdentity: identity,
  };
  return { ...t, tasks, request };
}
describe('shared PostgreSQL provider capacity', () => {
  it('serializes competing workers and expired leases restore concurrency after a crash', async () => {
    const t = await seed();
    const limited = { ...runtime, audits: { ...runtime.audits, per_transport_concurrency: 1 } };
    const at = new Date();
    const requests = t.tasks.slice(0, 2).map((task) => ({ ...t.request, taskId: task.id }));
    const decisions = await Promise.all(
      requests.map((request) => acquireCapacity(db, request, limited, at)),
    );
    expect(decisions.filter((decision) => decision.acquired)).toHaveLength(1);
    expect(decisions.find((decision) => !decision.acquired)).toMatchObject({
      code: 'capacity_concurrency',
    });
    const blockedIndex = decisions.findIndex((decision) => !decision.acquired);
    const future = new Date(at.getTime() + limited.audits.capacity_lease_ttl_seconds * 1000 + 1);
    expect((await acquireCapacity(db, requests[blockedIndex]!, limited, future)).acquired).toBe(
      true,
    );
  });
  it('consumes paced starts permanently and shares bounded cooldowns with sibling tasks', async () => {
    const t = await seed(),
      at = new Date();
    const first = { ...t.request, engine: 'google_ai_overview', transport: 'dataforseo' };
    const second = { ...first, taskId: t.tasks[1]!.id };
    expect((await acquireCapacity(db, first, runtime, at)).acquired).toBe(true);
    await releaseCapacity(db, first, runtime, {}, at);
    expect(await acquireCapacity(db, second, runtime, at)).toMatchObject({
      acquired: false,
      code: 'capacity_rate_limited',
      availableAt: new Date(at.getTime() + 1000),
    });
    const later = new Date(at.getTime() + 1000);
    expect((await acquireCapacity(db, second, runtime, later)).acquired).toBe(true);
    await releaseCapacity(
      db,
      second,
      runtime,
      { rateLimited: true, retryAfterSeconds: 1000000 },
      later,
    );
    await releaseCapacity(db, second, runtime, { rateLimited: true, retryAfterSeconds: 0 }, later);
    const decision = await acquireCapacity(db, { ...first, attempt: 2 }, runtime, later);
    expect(decision).toMatchObject({
      acquired: false,
      code: 'capacity_rate_limited',
      availableAt: new Date(later.getTime() + 60000),
    });
  });
});
describe('DataForSEO account identity compatibility', () => {
  const key = 'capacity-identity-test-key',
    cipher = createSecretCipher(key);
  // Reference vectors, including full Unicode casefold and strip semantics.
  const vectors = [
    ['  USER@Example.COM  ', 'a11a484b636deed1b5d02ffbcc02cbeb009cd47da4a7c13864b688404970f9e6'],
    [
      '\u0085Straße@EXAMPLE.COM\u0085',
      'c3c834cbb0fa050c0dd930b482089e403fae6b111adfe01ef4243f0bac472944',
    ],
    ['ΟΣ@example.com', 'ec7c019f038bb92c6b9fdf00775a8dae12fe68b48b69bb967265bac77def884b'],
    [
      '\ufeffUSER@example.com\ufeff',
      'db2d32a0ea9b0bb27db6abc634da419cabcb84cb0864ac7833ada2873219c432',
    ],
  ];
  it('retains the opaque pool through case normalization, Unicode and password rotation', () => {
    for (const [login, identity] of vectors)
      for (const password of ['old-password', 'rotated-password'])
        expect(
          dataforseoAccountIdentity(cipher.encrypt(JSON.stringify({ login, password })), key),
        ).toBe(identity);
  });
  it('refuses malformed stored credentials with a safe error', () => {
    const corrupt = cipher.encrypt('a-sensitive-credential-value');
    expect(() => dataforseoAccountIdentity(corrupt, key)).toThrow(
      'Stored DataForSEO credential is unreadable',
    );
  });
});
