/**
 * The per-request access path: one read resolves the acting user's membership
 * (and the path project), and nothing is kept between requests.
 */
import { randomUUID } from 'node:crypto';

import type { KyselyPlugin, RootOperationNode } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import {
  Fixtures,
  TEST_SESSION_COOKIE,
  sessionToken,
  testConfig,
  testDatabase,
} from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new Fixtures(db);

/** Every statement the request executed, in order; subqueries are part of their statement. */
const executed: string[] = [];
const pending = new Map<string, RootOperationNode>();
const recorder: KyselyPlugin = {
  transformQuery({ node, queryId }) {
    pending.set(queryId.queryId, node);
    return node;
  },
  transformResult({ queryId, result }) {
    const node = pending.get(queryId.queryId);
    if (node) executed.push(db.getExecutor().compileQuery(node, queryId).sql);
    return Promise.resolve(result);
  },
};
const app = createApp(config, db.withPlugin(recorder));

let userId: string;
let workspaceId: string;
let cookie: string;

async function sessionFor(user: string): Promise<string> {
  return `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: user })}`;
}

async function call(
  path: string,
  headers: Record<string, string> = { 'x-workspace-id': workspaceId },
) {
  executed.length = 0;
  pending.clear();
  const response = await app.request(path, { headers: { cookie, ...headers } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function insertProject(workspace: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('projects')
    .values({
      id,
      workspace_id: workspace,
      name: 'Access path',
      brand_name: 'Access path',
      website_url: 'https://example.test',
      industry: 'software',
      subindustry: 'analytics',
      primary_market: 'US',
      country_code: 'US',
      language_code: 'en',
      benchmark_mode: 'consumer_like',
      default_repetitions: 1,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  return id;
}

beforeAll(async () => {
  userId = await fixtures.user();
  workspaceId = await fixtures.ownedWorkspace(userId);
  cookie = await sessionFor(userId);
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('per-request access', () => {
  it('resolves the membership in one statement', async () => {
    const { status } = await call('/api/v1/api-keys');
    expect(status).toBe(200);
    const membershipReads = executed.filter((sql) => /\bfrom "workspace_members"/u.test(sql));
    expect(membershipReads).toHaveLength(1);
  });

  it('answers /auth/me without reading the password hash', async () => {
    const { status, body } = await call('/api/v1/auth/me');
    expect(status).toBe(200);
    expect(body.user).toMatchObject({ id: userId, email: `${userId}@example.test` });
    expect(executed).toHaveLength(1);
    expect(executed.join('\n')).not.toContain('hashed_password');
  });

  it('applies a removed membership from the next request', async () => {
    const member = await fixtures.user();
    const workspace = await fixtures.joinedWorkspace(member);
    const session = await sessionFor(member);
    const before = await call('/api/v1/api-keys', { cookie: session, 'x-workspace-id': workspace });
    await db
      .deleteFrom('workspace_members')
      .where('workspace_id', '=', workspace)
      .where('user_id', '=', member)
      .execute();
    const after = await call('/api/v1/api-keys', { cookie: session, 'x-workspace-id': workspace });
    expect([before.status, after.status, after.body.error]).toEqual([
      200,
      404,
      expect.objectContaining({ message: 'Workspace not found' }),
    ]);
  });
});

describe('active workspace selection', () => {
  it('refuses an empty X-Workspace-Id instead of falling back to the default workspace', async () => {
    const member = await fixtures.user();
    const workspace = await fixtures.ownedWorkspace(member);
    const project = await insertProject(workspace);
    const session = await sessionFor(member);
    const answers = [];
    for (const path of ['/api/v1/api-keys', `/api/v1/projects/${project}/readiness`]) {
      const empty = await call(path, { cookie: session, 'x-workspace-id': '' });
      const absent = await call(path, { cookie: session });
      answers.push([path, empty.status, empty.body.error, absent.status]);
    }
    expect(answers).toEqual(
      ['/api/v1/api-keys', `/api/v1/projects/${project}/readiness`].map((path) => [
        path,
        400,
        expect.objectContaining({ message: 'Invalid X-Workspace-Id' }),
        200,
      ]),
    );
  });

  it('breaks a tie between equally old memberships by membership ID', async () => {
    /** Whether the default workspace reads the lower-ID membership's project and refuses the other's. */
    async function defaultIsLowerId(ownedIdPrefix: '0' | 'f') {
      const member = await fixtures.user();
      const owned = await fixtures.ownedWorkspace(member);
      const invited = await fixtures.joinedWorkspace(member);
      const at = new Date('2026-01-01T00:00:00Z');
      for (const [workspace, prefix] of [
        [owned, ownedIdPrefix],
        [invited, ownedIdPrefix === '0' ? 'f' : '0'],
      ] as const)
        await db
          .updateTable('workspace_members')
          .set({ id: prefix + randomUUID().slice(1), created_at: at })
          .where('workspace_id', '=', workspace)
          .where('user_id', '=', member)
          .execute();
      const lower = await insertProject(ownedIdPrefix === '0' ? owned : invited);
      const higher = await insertProject(ownedIdPrefix === '0' ? invited : owned);
      const session = await sessionFor(member);
      return [
        (await call(`/api/v1/projects/${lower}/readiness`, { cookie: session })).status,
        (await call(`/api/v1/projects/${higher}/readiness`, { cookie: session })).status,
      ];
    }
    // Both orders, so neither insertion order nor workspace IDs can decide it.
    expect([await defaultIsLowerId('0'), await defaultIsLowerId('f')]).toEqual([
      [200, 404],
      [200, 404],
    ]);
  });
});
