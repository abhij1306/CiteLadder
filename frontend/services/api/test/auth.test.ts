import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { localAccount } from '../src/auth/local.ts';
import { sessionUser } from '../src/auth/session.ts';
import { workspaceMember } from '../src/auth/workspace.ts';
import type { AppEnv } from '../src/context.ts';
import { onError } from '../src/errors.ts';
import {
  TEST_SESSION_COOKIE,
  Fixtures,
  sessionToken,
  testConfig,
  testDatabase,
} from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new Fixtures(db);
const cookie = TEST_SESSION_COOKIE;

function probeApp(serviceConfig = config) {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.use('*', sessionUser(serviceConfig, db));
  app.get('/me', (c) => c.json({ id: c.get('user').id }));
  app.get('/w/:workspace_id', workspaceMember(db), (c) =>
    c.json({ id: c.get('workspace').workspaceId, capabilities: c.get('workspace').capabilities() }),
  );
  app.post('/w/:workspace_id', workspaceMember(db, 'write'), (c) => c.json({ ok: true }));
  return app;
}

type ProbeBody = {
  id?: string;
  capabilities?: string[];
  error: { code: string; message: string };
};

async function call(path: string, token?: string, method = 'GET', app = probeApp()) {
  const headers: Record<string, string> = token ? { Cookie: `${cookie}=${token}` } : {};
  const response = await app.request(path, { method, headers });
  const body = (await response.json()) as ProbeBody;
  return { status: response.status, body };
}

let userId: string;
let viewerToken: string;

beforeAll(async () => {
  userId = await fixtures.user();
  viewerToken = await sessionToken({ sub: userId });
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('the acting user', () => {
  it('acts as the local user, whatever cookie a production request sends', async () => {
    const { userId: local } = await localAccount(db);
    const production = probeApp({ ...config, auth: { ...config.auth, actingUser: undefined } });
    expect(await call('/me', viewerToken, 'GET', production)).toEqual({
      status: 200,
      body: { id: local },
    });
    expect(await call('/me')).toEqual({ status: 200, body: { id: local } });
  });

  it('acts as the fixture user a test cookie names', async () => {
    expect(await call('/me', viewerToken)).toEqual({ status: 200, body: { id: userId } });
  });
});

describe('workspace membership', () => {
  let viewed: string;

  beforeAll(async () => {
    viewed = await fixtures.ownedWorkspace(await fixtures.user());
    await fixtures.member(viewed, userId, 'viewer');
  });

  it('authorizes a member with the role capability set', async () => {
    const { status, body } = await call(`/w/${viewed}`, viewerToken);
    expect(status).toBe(200);
    expect(body).toEqual({ id: viewed, capabilities: ['read'] });
  });

  it('refuses a capability the role lacks', async () => {
    const { status, body } = await call(`/w/${viewed}`, viewerToken, 'POST');
    expect(status).toBe(403);
    expect(body.error).toMatchObject({ code: 'workspace_role_forbidden' });
  });

  it('cannot tell a foreign workspace from a missing one', async () => {
    const foreign = await fixtures.ownedWorkspace(await fixtures.user());
    const foreignResult = await call(`/w/${foreign}`, viewerToken);
    const missingResult = await call(`/w/${randomUUID()}`, viewerToken);
    expect(foreignResult.status).toBe(404);
    expect(foreignResult.body.error.message).toBe('Workspace not found');
    expect(missingResult.body.error.message).toBe(foreignResult.body.error.message);
  });

  it('never authorizes through a system workspace membership', async () => {
    // A stray membership row: system workspaces never have legitimate ones.
    const system = await fixtures.systemWorkspace();
    await fixtures.member(system, userId, 'owner');
    expect((await call(`/w/${system}`, viewerToken)).status).toBe(404);
  });

  it('rejects a malformed workspace id before querying', async () => {
    const { status, body } = await call('/w/not-a-uuid', viewerToken);
    expect(status).toBe(422);
    expect(body.error.code).toBe('validation_error');
  });

  it('cannot store a role outside the matrix', async () => {
    const odd = await fixtures.ownedWorkspace(await fixtures.user());
    await expect(fixtures.member(odd, userId, 'superuser')).rejects.toThrow(
      /ck_workspace_member_role/u,
    );
  });
});
