import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { setLogSink } from '../src/logging.ts';
import {
  Fixtures,
  TEST_SESSION_COOKIE,
  sessionToken,
  testConfig,
  testDatabase,
} from './support.ts';

const config = testConfig({ ABUSE_CLIENT_ERROR_CLIENT_LIMIT: '3' });
const db = testDatabase(config);
const fixtures = new Fixtures(db);
const app = createApp(config, db);
let userId: string, workspaceId: string, cookie: string;

const report = {
  kind: 'render',
  message: 'Cannot read properties of undefined (reading "points")',
  stack: 'TypeError: boom\n    at Plot (https://app.citeladder.test/app-assets/chart.js?v=2:1:40)',
  route: '/projects/1f0c/ai-traffic',
  release: 'abc123',
  component: 'chart',
};

/** Every browser acts as a user, so the budget is the fixture user's. */
async function clearClientBudget() {
  if (!userId) return;
  await db
    .deleteFrom('usage_windows')
    .where('subject_kind', '=', 'user')
    .where('subject_hash', '=', createHash('sha256').update(userId.toLowerCase()).digest('hex'))
    .where('operation', '=', 'client_errors.report')
    .execute();
}

async function send(body: unknown, headers: Record<string, string> = { cookie }) {
  const records: Record<string, unknown>[] = [];
  const restore = setLogSink((line) => records.push(JSON.parse(line) as Record<string, unknown>));
  try {
    const response = await app.request('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, records: records.filter((r) => r.event === 'client.error') };
  } finally {
    setLogSink(restore);
  }
}

beforeAll(async () => {
  userId = await fixtures.user();
  workspaceId = await fixtures.ownedWorkspace(userId);
  cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: userId, ver: 0 })}`;
});
beforeEach(clearClientBudget);
afterAll(async () => {
  await clearClientBudget();
  await fixtures.cleanup();
  await db.destroy();
});

describe('client error sink', () => {
  it('logs a report with its user and no workspace, without URL query strings, and answers 204', async () => {
    const result = await send(report);
    expect(result.status).toBe(204);
    expect(result.records).toEqual([
      expect.objectContaining({
        event: 'client.error',
        logger: 'api.client_errors',
        level: 'error',
        kind: 'render',
        message: 'Cannot read properties of undefined (reading "points")',
        stack:
          'TypeError: boom\n    at Plot (https://app.citeladder.test/app-assets/chart.js:1:40)',
        route: '/projects/1f0c/ai-traffic',
        release: 'abc123',
        component: 'chart',
        user_id: userId,
        workspace_id: null,
      }),
    ]);
  });

  it('takes the reporter from the acting user and logs a missing chunk as a warning', async () => {
    const result = await send(
      { ...report, kind: 'chunk_load', component: undefined },
      { cookie, 'x-workspace-id': workspaceId },
    );
    expect(result.status).toBe(204);
    expect(result.records).toEqual([
      expect.objectContaining({
        level: 'warning',
        kind: 'chunk_load',
        component: null,
        user_id: userId,
        workspace_id: workspaceId,
      }),
    ]);
  });

  it('records a workspace only when the user is a member of the one the request names', async () => {
    const stranger = await fixtures.user();
    const foreign = await fixtures.ownedWorkspace(stranger);
    const reporters = [];
    const requests: Record<string, string>[] = [{ cookie }, { cookie, 'x-workspace-id': foreign }];
    for (const headers of requests) {
      const result = await send(report, headers);
      expect(result.status).toBe(204);
      reporters.push(result.records.map((r) => [r.user_id, r.workspace_id]));
    }
    // No header never falls back to the user's own workspace; a foreign one is never trusted.
    expect(reporters).toEqual([[[userId, null]], [[userId, null]]]);
  });

  it('strips query strings and fragments from absolute, root-relative and relative URLs', async () => {
    const result = await send({
      ...report,
      message:
        'Loading /projects?search=private#top and ../report?token=abc failed. Was item #3 ok?',
      stack:
        'Error\n    at x (/app-assets/a.js?v=2:3:9)\n    at y@screens/b.js#frag:4\n    at z (https://h.test/c.js?q=1:5:6)',
    });
    expect(result.records).toEqual([
      expect.objectContaining({
        message: 'Loading /projects and ../report failed. Was item #3 ok?',
        stack:
          'Error\n    at x (/app-assets/a.js:3:9)\n    at y@screens/b.js:4\n    at z (https://h.test/c.js:5:6)',
      }),
    ]);
  });

  it('refuses reporter fields, unknown kinds, query strings and oversized fields', async () => {
    const refused = [
      { ...report, user_id: randomUUID() },
      { ...report, workspace_id: randomUUID() },
      { ...report, kind: 'network' },
      { ...report, route: '/projects?search=private' },
      { ...report, message: 'x'.repeat(501) },
    ];
    const statuses = [];
    for (const body of refused) {
      await clearClientBudget();
      statuses.push((await send(body)).status);
    }
    expect(statuses).toEqual([422, 422, 422, 422, 422]);
  });

  it('refuses a body over the byte cap before parsing it', async () => {
    const result = await send(JSON.stringify({ ...report, padding: 'x'.repeat(20000) }));
    expect(result).toEqual({ status: 413, records: [] });
  });

  it('throttles one user past its budget', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await send(report)).status);
    expect(statuses).toEqual([204, 204, 204, 429]);
  });
});
