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
let projectId: string;
let chatId: string;
let cookie: string;

async function sessionFor(user: string): Promise<string> {
  return `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: user })}`;
}

async function call(
  path: string,
  headers: Record<string, string> = { 'x-workspace-id': workspaceId },
  method = 'GET',
) {
  executed.length = 0;
  pending.clear();
  const write = method === 'GET' ? {} : { body: '{}' };
  const response = await app.request(path, {
    method,
    headers: {
      cookie,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...write,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Statements whose first table is `table`. */
function readsOf(statements: readonly string[], table: string): number {
  return statements.filter((statement) => /\bfrom "(\w+)"/u.exec(statement)?.[1] === table).length;
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

async function insertChat(workspace: string, project: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db
    .insertInto('agent_chats')
    .values({
      id,
      workspace_id: workspace,
      project_id: project,
      title: 'Access path',
      context_refs: {},
      turn_count: 0,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}

beforeAll(async () => {
  userId = await fixtures.user();
  workspaceId = await fixtures.ownedWorkspace(userId);
  projectId = await insertProject(workspaceId);
  chatId = await insertChat(workspaceId, projectId);
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

  it('opens an Agent chat and its revisions reading the chat once, with no further access reads', async () => {
    const answers = [];
    for (const path of [
      `/api/v1/agent/chats/${chatId}`,
      `/api/v1/agent/chats/${chatId}/output/revisions`,
    ]) {
      const { status } = await call(path);
      answers.push([
        status,
        readsOf(executed, 'workspace_members'),
        readsOf(executed, 'users'),
        readsOf(executed, 'agent_chats'),
      ]);
    }
    expect(answers).toEqual([
      [200, 1, 0, 1],
      [200, 1, 0, 1],
    ]);
  });

  it.each([
    ['the Agent chat list', '/api/v1/projects/{project}/agent/chats'],
    ['the Agent instructions', '/api/v1/projects/{project}/agent/instructions'],
    ['the Overview layout', '/api/v1/projects/{project}/overview/layout'],
    ['the opportunity catalog', '/api/v1/projects/{project}/opportunities'],
    ['the topic list', '/api/v1/projects/{project}/topics'],
  ])('opens %s on the membership read alone', async (_label, template) => {
    const { status } = await call(template.replace('{project}', projectId));
    expect([
      status,
      readsOf(executed, 'workspace_members'),
      readsOf(executed, 'users'),
      readsOf(executed, 'projects'),
    ]).toEqual([200, 1, 0, 0]);
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

describe('routes that authorize the path project or chat', () => {
  const PROJECT_READS = [
    '/api/v1/projects/{project}/agent/chats',
    '/api/v1/projects/{project}/agent/instructions',
    '/api/v1/projects/{project}/overview/layout',
    '/api/v1/projects/{project}/overview/report.pdf',
    '/api/v1/projects/{project}/opportunities',
    '/api/v1/projects/{project}/topics',
    '/api/v1/projects/{project}/seed-queries',
  ];
  const PROJECT_WRITES: [string, string][] = [
    ['POST', '/api/v1/projects/{project}/agent/chats'],
    ['PUT', '/api/v1/projects/{project}/agent/instructions'],
    ['PUT', '/api/v1/projects/{project}/overview/layout'],
    ['PUT', '/api/v1/projects/{project}/opportunities/order'],
    ['POST', '/api/v1/projects/{project}/topics'],
    ['POST', '/api/v1/projects/{project}/topics/preview'],
    ['POST', '/api/v1/projects/{project}/topics/confirm'],
  ];
  const CHAT_READS = ['/api/v1/agent/chats/{chat}', '/api/v1/agent/chats/{chat}/output/revisions'];

  async function stranger() {
    const member = await fixtures.user();
    await fixtures.ownedWorkspace(member);
    return sessionFor(member);
  }

  it('hides another workspace project, and a missing one, on every read and write', async () => {
    const session = await stranger();
    const missing = randomUUID();
    const answers = [];
    for (const [method, template] of [
      ...PROJECT_READS.map((path) => ['GET', path] as const),
      ...PROJECT_WRITES,
    ]) {
      const foreign = await call(
        template.replace('{project}', projectId),
        { cookie: session },
        method,
      );
      const absent = await call(template.replace('{project}', missing), { cookie }, method);
      answers.push([method, template, foreign.status, foreign.body.error, absent.status]);
    }
    const notFound = expect.objectContaining({ message: 'Project not found' });
    expect(answers).toEqual(
      [...PROJECT_READS.map((path) => ['GET', path] as const), ...PROJECT_WRITES].map(
        ([method, template]) => [method, template, 404, notFound, 404],
      ),
    );
  });

  it('hides another workspace chat', async () => {
    const session = await stranger();
    const answers = [];
    for (const template of CHAT_READS) {
      const foreign = await call(template.replace('{chat}', chatId), { cookie: session });
      answers.push([template, foreign.status, foreign.body.error]);
    }
    expect(answers).toEqual(
      CHAT_READS.map((template) => [
        template,
        404,
        expect.objectContaining({ message: 'Chat not found' }),
      ]),
    );
  });

  it('lets a viewer read the project but refuses its writes before reading the body', async () => {
    const viewer = await fixtures.user();
    await fixtures.member(workspaceId, viewer, 'viewer');
    const headers = { cookie: await sessionFor(viewer), 'x-workspace-id': workspaceId };
    const reads = [];
    for (const template of ['/api/v1/projects/{project}/opportunities', ...CHAT_READS])
      reads.push(
        (await call(template.replace('{project}', projectId).replace('{chat}', chatId), headers))
          .status,
      );
    const writes = [];
    for (const [method, template] of PROJECT_WRITES)
      writes.push((await call(template.replace('{project}', projectId), headers, method)).status);
    expect([reads, writes]).toEqual([[200, 200, 200], PROJECT_WRITES.map(() => 403)]);
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
